import http from "http";
import fs from "fs-extra";
import { buildError, buildSuccess } from "./error-formatter.js";
import { ErrorCode } from "./error-codes.js";
import { buildClientCodeSchema } from "../client-schema-builder.js";
import { logger, toErrorMessage } from "./logger.js";
import { getEndpointsPath, getOperationArtifactPath, getSchemaPath } from "./paths.js";
import { getSchemaType, buildDeterministicResponseValue, buildDeterministicValueFromSchema } from "../validate-response.js";
import { loadConfig, updateConfig } from "../index.js";
import { getSanitizedOperationId } from "./endpoint-utils.js";
import { buildGraphQLResponseDataForSelection } from "./graphql.js";
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function normalizePathname(value) {
    if (!value) {
        return "/";
    }
    try {
        return new URL(value, "http://127.0.0.1").pathname || "/";
    }
    catch {
        return value.startsWith("/") ? value : `/${value}`;
    }
}
function compileOpenApiPathMatcher(template) {
    const parts = template.split("/").map(segment => {
        const trimmed = segment.trim();
        if (/^\{[^/{}]+\}$/.test(trimmed)) {
            return "[^/]+";
        }
        return escapeRegex(trimmed);
    });
    return new RegExp(`^${parts.join("/")}$`);
}
function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function normalizeHeaders(value) {
    if (!isPlainObject(value)) {
        return {};
    }
    const headers = {};
    for (const [key, headerValue] of Object.entries(value)) {
        if (typeof headerValue === "string") {
            headers[key] = headerValue;
        }
    }
    return headers;
}
function inferContentType(body, headers) {
    const existing = Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1];
    if (existing) {
        return existing;
    }
    if (typeof body === "string") {
        return "text/plain; charset=utf-8";
    }
    return "application/json; charset=utf-8";
}
function writeResponse(res, statusCode, payload, headers = {}) {
    const responseHeaders = { ...headers };
    const contentType = Object.entries(responseHeaders).find(([key]) => key.toLowerCase() === "content-type")?.[1]
        ?? (typeof payload === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8");
    if (!Object.keys(responseHeaders).some(key => key.toLowerCase() === "content-type")) {
        responseHeaders["Content-Type"] = contentType;
    }
    res.statusCode = statusCode;
    for (const [key, value] of Object.entries(responseHeaders)) {
        res.setHeader(key, value);
    }
    if (Buffer.isBuffer(payload)) {
        res.end(payload);
        return;
    }
    if (typeof payload === "string" && !/json/i.test(contentType)) {
        res.end(payload);
        return;
    }
    res.end(JSON.stringify(payload));
}
async function readRequestBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
}
async function readJsonBody(req) {
    const bodyText = await readRequestBody(req);
    if (!bodyText.trim()) {
        return {};
    }
    return JSON.parse(bodyText);
}
function isStoredResponseEnvelope(value) {
    return isPlainObject(value) && ("body" in value || "status" in value || "headers" in value);
}
function extractStoredResponse(value) {
    if (isStoredResponseEnvelope(value)) {
        const status = typeof value.status === "number" ? value.status : 200;
        const headers = normalizeHeaders(value.headers);
        const body = value.body === undefined ? value : value.body;
        return { status, headers, body };
    }
    return { status: 200, headers: {}, body: value };
}
function isSuccessfulStatus(status) {
    return status >= 200 && status < 300;
}
function readReplayableStoredResponse(value) {
    const stored = extractStoredResponse(value);
    if (isStoredResponseEnvelope(value) && !isSuccessfulStatus(stored.status)) {
        return null;
    }
    return stored;
}
function isMethodMatch(method, requestMethod) {
    return typeof method === "string" && method.toLowerCase() === requestMethod.toLowerCase();
}
function matchOpenApiRoute(routes, pathname, method) {
    const pathMatches = routes.filter(route => compileOpenApiPathMatcher(route.path).test(pathname));
    if (pathMatches.length === 0) {
        return {};
    }
    const methodMatches = pathMatches.filter(route => isMethodMatch(route.method, method));
    if (methodMatches.length === 0) {
        return { pathMatch: true };
    }
    return { matchedRoute: methodMatches[0], pathMatch: true };
}
function matchGraphQLRoute(routes, requestBody) {
    const payload = isPlainObject(requestBody) ? requestBody : {};
    const operationName = typeof payload.operationName === "string" ? payload.operationName.trim() : "";
    if (operationName) {
        return routes.find(route => route.operationId === operationName
            || route.sanitizedOperationId === operationName
            || route.name === operationName);
    }
    const query = typeof payload.query === "string" ? payload.query : "";
    if (!query) {
        return undefined;
    }
    return routes.find(route => {
        const tokens = [route.operationId, route.sanitizedOperationId, route.name].filter(Boolean);
        return tokens.some(token => new RegExp(`\\b${escapeRegex(token)}\\b`).test(query));
    });
}
async function loadMockRoutes(apiName) {
    const config = await loadConfig();
    const apiConfig = config.apis?.[apiName];
    if (!apiConfig) {
        throw new Error(`API '${apiName}' is not installed.`);
    }
    const endpointsPath = getEndpointsPath(apiName);
    if (!(await fs.pathExists(endpointsPath))) {
        throw new Error(`Missing endpoints.json for API '${apiName}'.`);
    }
    let endpoints;
    try {
        const parsed = await fs.readJson(endpointsPath);
        if (!Array.isArray(parsed)) {
            throw new Error("endpoints.json must contain an array.");
        }
        endpoints = parsed;
    }
    catch (error) {
        throw new Error(`Failed to read endpoints.json for API '${apiName}': ${toErrorMessage(error)}`);
    }
    const schemaType = await getSchemaType(apiName);
    const routes = [];
    for (const endpoint of endpoints) {
        const operationId = typeof endpoint.operationId === "string"
            ? endpoint.operationId
            : typeof endpoint.name === "string"
                ? endpoint.name
                : "";
        const sanitizedOperationId = typeof endpoint.sanitizedOperationId === "string" && endpoint.sanitizedOperationId.trim().length > 0
            ? endpoint.sanitizedOperationId
            : await getSanitizedOperationId(apiName, operationId);
        if (!sanitizedOperationId) {
            throw new Error(`Missing sanitized operation id for endpoint '${operationId || "<unknown>"}'.`);
        }
        const schemaPath = getSchemaPath(apiName, sanitizedOperationId);
        const responsePath = getOperationArtifactPath(apiName, sanitizedOperationId, "response");
        const responseSchemaPath = getOperationArtifactPath(apiName, sanitizedOperationId, "response-schema");
        try {
            if (schemaType === "graphql") {
                if (!(await fs.pathExists(schemaPath))) {
                    throw new Error(`Missing operation schema for '${operationId || sanitizedOperationId}' at ${schemaPath}.`);
                }
                const schema = await fs.readJson(schemaPath);
                const rootType = typeof schema.rootType === "string" ? schema.rootType : typeof endpoint.rootType === "string" ? endpoint.rootType : "";
                const name = typeof schema.name === "string" ? schema.name : typeof endpoint.name === "string" ? endpoint.name : "";
                if (!name || !rootType) {
                    throw new Error(`Invalid GraphQL endpoint schema for '${operationId || sanitizedOperationId}'.`);
                }
                routes.push({
                    kind: "graphql",
                    operationId: schema.operationId ?? operationId,
                    sanitizedOperationId,
                    name,
                    rootType: rootType,
                    schema,
                    schemaPath,
                    responsePath,
                    responseSchemaPath,
                });
            }
            else {
                const method = typeof endpoint.method === "string" ? endpoint.method : "";
                const routePath = typeof endpoint.path === "string" ? endpoint.path : "";
                if (!method || !routePath) {
                    throw new Error(`Invalid OpenAPI endpoint schema for '${operationId || sanitizedOperationId}'.`);
                }
                routes.push({
                    kind: "openapi",
                    operationId,
                    sanitizedOperationId,
                    method,
                    path: routePath,
                    schema: endpoint,
                    schemaPath,
                    responsePath,
                    responseSchemaPath,
                });
            }
        }
        catch (error) {
            throw new Error(`Failed to read operation schema for '${operationId || sanitizedOperationId}': ${toErrorMessage(error)}`);
        }
    }
    return { apiName, schemaType, routes };
}
function buildRouteNotFoundResponse(apiName, pathname, method) {
    return buildError(ErrorCode.MOCK_ROUTE_NOT_FOUND, {
        summary: "No matching mock route was found.",
        message: `No route matched ${method} ${pathname} for API '${apiName}'.`,
        context: { api_name: apiName, path: pathname, method },
        nextCommand: "Check endpoints.json and the request path.",
    });
}
function buildMethodNotAllowedResponse(apiName, pathname, method) {
    return buildError(ErrorCode.MOCK_METHOD_NOT_ALLOWED, {
        summary: "The request path exists but the HTTP method does not match.",
        message: `The route ${pathname} exists for API '${apiName}', but ${method} is not allowed.`,
        context: { api_name: apiName, path: pathname, method },
        nextCommand: "Use the generated HTTP method for this route.",
    });
}
function buildArtifactError(apiName, operationId, artifactPath, error) {
    return buildError(ErrorCode.MOCK_ARTIFACT_INVALID, {
        summary: "The mock server could not read a generated artifact.",
        message: `Failed to read artifact for '${operationId}' in API '${apiName}': ${toErrorMessage(error)}`,
        context: { api_name: apiName, operation_id: operationId, artifact_path: artifactPath },
        nextCommand: "Regenerate the API artifacts and retry.",
    });
}
async function serveOpenApiRoute(apiName, route, res) {
    if (await fs.pathExists(route.responsePath)) {
        const stored = await fs.readJson(route.responsePath);
        const replayable = readReplayableStoredResponse(stored);
        if (replayable) {
            const { body, headers, status } = replayable;
            const contentType = inferContentType(body, headers);
            writeResponse(res, status, body, { ...headers, "Content-Type": contentType });
            return;
        }
    }
    let body = null;
    if (await fs.pathExists(route.responseSchemaPath)) {
        const responseSchema = await fs.readJson(route.responseSchemaPath);
        body = buildDeterministicValueFromSchema(responseSchema);
    }
    if (body === null && await fs.pathExists(route.schemaPath)) {
        const operationSchema = await fs.readJson(route.schemaPath);
        body = buildDeterministicResponseValue(operationSchema);
    }
    if (body === null) {
        const clientSchema = await buildClientCodeSchema(apiName, route.operationId, route.sanitizedOperationId, false);
        if ("schemaType" in clientSchema && clientSchema.schemaType === "rest") {
            if (clientSchema.response?.schema) {
                body = buildDeterministicValueFromSchema(clientSchema.response.schema);
            }
            else if (clientSchema.requestBody?.schema) {
                body = buildDeterministicValueFromSchema(clientSchema.requestBody.schema);
            }
        }
    }
    if (body === null) {
        body = buildDeterministicValueFromSchema({ type: "object", properties: {} });
    }
    writeResponse(res, 200, body, { "Content-Type": "application/json; charset=utf-8" });
}
async function serveGraphQLRoute(route, requestBody, res) {
    if (await fs.pathExists(route.responsePath)) {
        const stored = await fs.readJson(route.responsePath);
        const replayable = readReplayableStoredResponse(stored);
        if (replayable) {
            const { body, headers, status } = replayable;
            const contentType = inferContentType(body, headers);
            writeResponse(res, status, body, { ...headers, "Content-Type": contentType });
            return;
        }
    }
    const { responseKey, data, errors } = buildGraphQLResponseDataForSelection(route.schema.returns, requestBody, route.name);
    if (errors && errors.length > 0) {
        writeResponse(res, 200, {
            data: { [responseKey]: data },
            errors,
        }, { "Content-Type": "application/json; charset=utf-8" });
        return;
    }
    writeResponse(res, 200, { data: { [responseKey]: data } }, { "Content-Type": "application/json; charset=utf-8" });
}
export async function startMockServer(apiName, host = "127.0.0.1", port = 3000) {
    const { schemaType, routes } = await loadMockRoutes(apiName);
    const openApiRoutes = routes.filter((route) => route.kind === "openapi");
    const graphqlRoutes = routes.filter((route) => route.kind === "graphql");
    const server = http.createServer(async (req, res) => {
        try {
            const method = (req.method ?? "GET").toUpperCase();
            const pathname = normalizePathname(req.url ?? "/");
            if (pathname === "/mock-health") {
                if (method !== "GET") {
                    writeResponse(res, 405, buildMethodNotAllowedResponse(apiName, pathname, method));
                    return;
                }
                writeResponse(res, 200, {
                    ok: true,
                    apiName,
                    status: "running",
                }, { "Content-Type": "application/json; charset=utf-8" });
                return;
            }
            if (schemaType === "graphql") {
                if (pathname !== "/" && pathname !== "/graphql") {
                    writeResponse(res, 404, buildRouteNotFoundResponse(apiName, pathname, method));
                    return;
                }
                if (method !== "POST") {
                    writeResponse(res, 405, buildMethodNotAllowedResponse(apiName, pathname, method));
                    return;
                }
                const requestBody = await readJsonBody(req);
                const matchedRoute = matchGraphQLRoute(graphqlRoutes, requestBody);
                if (!matchedRoute) {
                    writeResponse(res, 404, buildRouteNotFoundResponse(apiName, pathname, method));
                    return;
                }
                logger.info(JSON.stringify({
                    kind: "mock-server-request",
                    apiName,
                    operationId: matchedRoute.operationId,
                    method,
                    path: pathname,
                    artifactPath: matchedRoute.responsePath,
                }));
                await serveGraphQLRoute(matchedRoute, requestBody, res);
                return;
            }
            const matched = matchOpenApiRoute(openApiRoutes, pathname, method);
            if (!matched.matchedRoute) {
                if (matched.pathMatch) {
                    writeResponse(res, 405, buildMethodNotAllowedResponse(apiName, pathname, method));
                }
                else {
                    writeResponse(res, 404, buildRouteNotFoundResponse(apiName, pathname, method));
                }
                return;
            }
            logger.info(JSON.stringify({
                kind: "mock-server-request",
                apiName,
                operationId: matched.matchedRoute.operationId,
                method,
                path: pathname,
                artifactPath: matched.matchedRoute.responsePath,
            }));
            await serveOpenApiRoute(apiName, matched.matchedRoute, res);
        }
        catch (error) {
            const payload = buildError(ErrorCode.MOCK_SERVER_STARTUP_FAILED, {
                summary: "The mock server failed while handling a request.",
                message: toErrorMessage(error),
                context: { api_name: apiName },
                nextCommand: "Inspect the mock server artifacts and retry.",
            });
            writeResponse(res, 500, payload);
        }
    });
    const mockUrl = await new Promise((resolve, reject) => {
        const onError = (error) => {
            server.off("listening", onListening);
            reject(error);
        };
        const onListening = () => {
            server.off("error", onError);
            const address = server.address();
            if (!address || typeof address === "string") {
                reject(new Error("The mock server did not receive a usable address."));
                return;
            }
            resolve(`http://${host}:${address.port}`);
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
    });
    await updateConfig(apiName, { mockUrl });
    logger.result(buildSuccess({ apiName, mockUrl }, { kind: "mock-server-started" }));
    return { server, mockUrl, apiName };
}
//# sourceMappingURL=mock-server.js.map