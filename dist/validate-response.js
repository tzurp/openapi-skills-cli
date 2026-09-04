import { FetchClient } from "./helper/http-client.js";
import fs from "fs-extra";
import path from "path";
import { getSchemaPath, getSchemasDir, findRequestResponseDir } from "./helper/paths.js";
import Ajv from "ajv";
import { buildClientCodeSchema } from "./client-schema-builder.js";
import { DELETE_SENTINEL, loadJsonObject, updateJsonFile } from "./helper/json-updater.js";
import { loadConfig } from "./index.js";
import getSanitizedOperationId from "./helper/endpoint-utils.js";
import { ErrorCode } from "./helper/error-codes.js";
import { getParameterDefaultValue } from "./helper/parameter-schema.js";
import { getByPath } from "./helper/dotNotation.js";
import { buildGraphQLArtifact, findGraphQLEndpoint } from "./helper/graphql.js";
import { getEndpointsPath } from "./helper/paths.js";
import { ensureEndpointSchemaFile } from "./parser.js";
import { fileURLToPath } from "url";
function unwrapResponseBody(responseJson) {
    if (responseJson && typeof responseJson === "object" && !Array.isArray(responseJson)) {
        const maybeEnvelope = responseJson;
        if (Object.prototype.hasOwnProperty.call(responseJson, "body")) {
            return maybeEnvelope.body;
        }
    }
    return responseJson;
}
export function isStructuredRequestError(error) {
    return !!error
        && typeof error === "object"
        && typeof error.code === "string"
        && Object.values(ErrorCode).includes(error.code);
}
function createStructuredRequestError(code, message, options) {
    const error = new Error(message);
    error.code = code;
    error.summary = options.summary;
    error.context = options.context;
    error.nextCommand = options.nextCommand;
    error.reason = options.reason;
    return error;
}
function parseJsonResponseBody(text) {
    const trimmed = text.trim();
    if (!trimmed) {
        return {};
    }
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return text;
    }
}
async function readMockHealth(mockUrl, timeoutMs = 2500) {
    const healthUrl = `${mockUrl.replace(/\/$/, "")}/mock-health`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(healthUrl, { method: "GET", signal: controller.signal });
        const text = await response.text();
        return { status: response.status, body: parseJsonResponseBody(text) };
    }
    finally {
        clearTimeout(timeout);
    }
}
function buildMockServerUnavailableError(apiName, mockUrl, detail) {
    return createStructuredRequestError(ErrorCode.MOCK_SERVER_UNAVAILABLE, detail, {
        summary: "The configured mock server is not reachable.",
        context: {
            api_name: apiName,
            mock_url: mockUrl,
        },
        nextCommand: `openapi-skills mock-server --api ${apiName}`,
    });
}
function buildMockServerMismatchError(apiName, mockUrl, runningApiName) {
    return createStructuredRequestError(ErrorCode.MOCK_SERVER_MISMATCH, `The configured mockUrl for API '${apiName}' points to a running mock server for API '${runningApiName}'.`, {
        summary: "The configured mock URL belongs to a different API.",
        context: {
            api_name: apiName,
            mock_url: mockUrl,
            expected_api_name: apiName,
            running_api_name: runningApiName,
        },
        nextCommand: `openapi-skills mock-server --api ${apiName}`,
    });
}
async function ensureMockServerAvailable(apiName, mockUrl) {
    if (!mockUrl.trim()) {
        throw buildMockServerUnavailableError(apiName, mockUrl, `Mock URL not found in config for API '${apiName}'. Start the mock server first.`);
    }
    let health;
    try {
        health = await readMockHealth(mockUrl);
    }
    catch (error) {
        throw buildMockServerUnavailableError(apiName, mockUrl, `The configured mock server for API '${apiName}' is not reachable at ${mockUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const healthBody = health.body;
    const reportedApiName = healthBody && typeof healthBody === "object" && !Array.isArray(healthBody)
        ? healthBody.apiName
        : undefined;
    if (health.status !== 200 || typeof reportedApiName !== "string" || reportedApiName.trim().length === 0) {
        throw buildMockServerUnavailableError(apiName, mockUrl, `The configured mock server for API '${apiName}' did not return a valid health response at ${mockUrl}/mock-health.`);
    }
    const normalizedReportedApiName = reportedApiName.trim();
    if (normalizedReportedApiName !== apiName) {
        throw buildMockServerMismatchError(apiName, mockUrl, normalizedReportedApiName);
    }
}
function flattenToDotNotation(value, prefix = "", out = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return out;
    }
    for (const [key, child] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (child && typeof child === "object" && !Array.isArray(child)) {
            flattenToDotNotation(child, path, out);
        }
        else {
            out[path] = child;
        }
    }
    return out;
}
function collectNestedUpdateKeys(value, prefix = "") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return [];
    }
    const nestedKeys = [];
    for (const [key, childValue] of Object.entries(value)) {
        const currentKey = prefix ? `${prefix}.${key}` : key;
        if (childValue && typeof childValue === "object" && !Array.isArray(childValue)) {
            nestedKeys.push(currentKey);
            nestedKeys.push(...collectNestedUpdateKeys(childValue, currentKey));
        }
    }
    return Array.from(new Set(nestedKeys));
}
function buildUpdateRequestWarning(requestJsonUpdates) {
    const nestedKeys = collectNestedUpdateKeys(requestJsonUpdates);
    if (nestedKeys.length === 0) {
        return undefined;
    }
    const flattened = flattenToDotNotation(requestJsonUpdates);
    const example = JSON.stringify(flattened);
    return [
        `Use only flattened object dot-notation keys with --force.`,
        `Example: --force --update-request '${example}'.`,
        `Detected nested keys: ${nestedKeys.join(", ")}.`
    ].join(" ");
}
function describeValueType(value) {
    if (value === null) {
        return "null";
    }
    if (isFileDescriptorTemplateValue(value)) {
        return "file";
    }
    if (Array.isArray(value)) {
        return "array";
    }
    return typeof value;
}
function isFileDescriptorTemplateValue(value) {
    return !!value
        && typeof value === "object"
        && !Array.isArray(value)
        && value.kind === "file";
}
function isFileDescriptorValue(value) {
    return !!value
        && typeof value === "object"
        && !Array.isArray(value)
        && typeof value.path === "string"
        && (value.kind === undefined || value.kind === "file");
}
function matchesExpectedTemplateValue(expectedValue, actualValue) {
    if (isFileDescriptorTemplateValue(expectedValue)) {
        return typeof actualValue === "string"
            || isFileDescriptorValue(actualValue);
    }
    if (expectedValue === null) {
        return actualValue === null;
    }
    if (Array.isArray(expectedValue)) {
        return Array.isArray(actualValue);
    }
    if (typeof expectedValue === "object") {
        return !!actualValue && typeof actualValue === "object" && !Array.isArray(actualValue);
    }
    return typeof actualValue === typeof expectedValue;
}
function isGraphQLRequestJson(value) {
    return !!value && typeof value === "object" && !Array.isArray(value)
        && typeof value.query === "string"
        && typeof value.variables === "object"
        && !Array.isArray(value.variables);
}
function normalizeMultipartContentType(value) {
    if (!value) {
        return undefined;
    }
    return value.split(",")[0]?.trim() || undefined;
}
function inferMimeTypeFromExtension(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    switch (extension) {
        case ".pdf":
            return "application/pdf";
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".png":
            return "image/png";
        case ".webp":
            return "image/webp";
        case ".gif":
            return "image/gif";
        case ".txt":
            return "text/plain";
        case ".csv":
            return "text/csv";
        case ".json":
            return "application/json";
        case ".xml":
            return "application/xml";
        case ".xlsx":
            return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        case ".xls":
            return "application/vnd.ms-excel";
        case ".docx":
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        case ".zip":
            return "application/zip";
        default:
            return "application/octet-stream";
    }
}
function normalizeFilePath(value) {
    const trimmed = value.trim();
    if (trimmed.startsWith("@")) {
        return path.resolve(trimmed.slice(1));
    }
    if (trimmed.startsWith("file://")) {
        return path.resolve(fileURLToPath(new URL(trimmed)));
    }
    return path.resolve(trimmed);
}
async function resolveFileInput(value, fallbackMimeType) {
    let filePath;
    let fileName;
    let mimeType;
    if (typeof value === "string") {
        if (value.trim().length === 0) {
            throw new Error("File upload path cannot be empty.");
        }
        filePath = normalizeFilePath(value);
    }
    else if (isFileDescriptorValue(value)) {
        if (value.path.trim().length === 0) {
            throw new Error("File upload path cannot be empty.");
        }
        filePath = normalizeFilePath(value.path);
        fileName = value.fileName?.trim() || undefined;
        mimeType = value.mimeType?.trim() || undefined;
    }
    if (!filePath) {
        throw new Error("File upload values must be a file path string or { kind: 'file', path, fileName?, mimeType? } object.");
    }
    if (!(await fs.pathExists(filePath))) {
        throw new Error(`Upload file not found: ${filePath}`);
    }
    const buffer = await fs.readFile(filePath);
    const resolvedFileName = fileName || path.basename(filePath);
    const resolvedMimeType = mimeType || normalizeMultipartContentType(fallbackMimeType) || inferMimeTypeFromExtension(filePath);
    return {
        buffer,
        path: filePath,
        fileName: resolvedFileName,
        mimeType: resolvedMimeType,
    };
}
function bufferToBlobPart(buffer) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
function findPreferredRequestContent(content) {
    const entries = Object.entries(content);
    const multipartEntry = entries.find(([contentType]) => contentType.toLowerCase().includes("multipart/form-data"));
    if (multipartEntry) {
        return { contentType: multipartEntry[0], contentObject: multipartEntry[1] };
    }
    const binaryEntry = entries.find(([contentType, contentObject]) => {
        const schema = contentObject?.schema;
        return contentType.toLowerCase().includes("octet-stream")
            || (schema?.type === "string" && schema?.format === "binary");
    });
    if (binaryEntry) {
        return { contentType: binaryEntry[0], contentObject: binaryEntry[1] };
    }
    const jsonEntry = entries.find(([contentType]) => contentType.toLowerCase().includes("json"));
    if (jsonEntry) {
        return { contentType: jsonEntry[0], contentObject: jsonEntry[1] };
    }
    const firstEntry = entries[0];
    return firstEntry ? { contentType: firstEntry[0], contentObject: firstEntry[1] } : undefined;
}
function getRequestBodyTransportSpec(operationSchema) {
    const requestBody = operationSchema?.requestBody;
    const params = Array.isArray(operationSchema?.parameters) ? operationSchema.parameters : [];
    const formParams = params.filter((p) => p && p.in === "formData");
    const consumes = Array.isArray(operationSchema?.consumes) ? operationSchema.consumes : [];
    const isMultipartFormData = consumes.some((contentType) => typeof contentType === "string" && contentType.toLowerCase().includes("multipart/form-data"));
    if (formParams.length > 0 && isMultipartFormData) {
        return {
            kind: "multipart",
            schema: extractRequestSchemaOAS2(operationSchema) ?? { type: "object", properties: {} },
            encoding: {},
        };
    }
    if (!requestBody || typeof requestBody !== "object") {
        if (formParams.length > 0) {
            return {
                kind: "multipart",
                schema: extractRequestSchemaOAS2(operationSchema) ?? { type: "object", properties: {} },
                encoding: {},
            };
        }
        return { kind: "json" };
    }
    const content = requestBody.content;
    if (content && typeof content === "object" && !Array.isArray(content)) {
        const preferred = findPreferredRequestContent(content);
        if (!preferred) {
            return { kind: "json" };
        }
        const mediaType = preferred.contentObject;
        const schema = mediaType?.schema;
        if (preferred.contentType.toLowerCase().includes("multipart/form-data")) {
            return {
                kind: "multipart",
                schema: schema && typeof schema === "object" ? schema : { type: "object", properties: {} },
                encoding: mediaType?.encoding ?? {},
            };
        }
        if (preferred.contentType.toLowerCase().includes("octet-stream") || (schema?.type === "string" && schema?.format === "binary")) {
            return {
                kind: "binary",
                contentType: preferred.contentType,
            };
        }
    }
    return { kind: "json" };
}
export async function buildRequestBodyTransport(operationSchema, requestJsonOrBody) {
    const transportSpec = getRequestBodyTransportSpec(operationSchema);
    if (transportSpec.kind === "multipart") {
        const requestJson = requestJsonOrBody;
        const hasRequestShape = !!requestJson
            && typeof requestJson === "object"
            && !Array.isArray(requestJson)
            && ("requestBody" in requestJson || "parameters" in requestJson);
        const bodyObject = hasRequestShape
            ? requestJson.requestBody
            : requestJsonOrBody;
        const fallbackFormData = hasRequestShape && Array.isArray(requestJson?.parameters)
            ? Object.fromEntries(requestJson.parameters
                .filter((param) => !!param
                && param.in === "formData"
                && typeof param.name === "string")
                .map(param => [param.name, param.value]))
            : {};
        const multipartBody = bodyObject && typeof bodyObject === "object" && !Array.isArray(bodyObject)
            ? bodyObject
            : fallbackFormData;
        if (!multipartBody || typeof multipartBody !== "object" || Array.isArray(multipartBody)) {
            throw new Error("multipart/form-data request bodies must be JSON objects.");
        }
        const formData = new FormData();
        const schemaProperties = transportSpec.schema?.properties && typeof transportSpec.schema.properties === "object"
            ? transportSpec.schema.properties
            : {};
        for (const [fieldName, fieldValue] of Object.entries(multipartBody)) {
            const fieldSchema = schemaProperties[fieldName];
            const fieldEncoding = transportSpec.encoding[fieldName];
            const fieldContentType = normalizeMultipartContentType(fieldEncoding?.contentType);
            if (fieldSchema?.type === "string" && fieldSchema?.format === "binary") {
                const file = await resolveFileInput(fieldValue, fieldContentType);
                formData.append(fieldName, new Blob([bufferToBlobPart(file.buffer)], { type: file.mimeType }), file.fileName);
                continue;
            }
            if (isFileDescriptorValue(fieldValue)) {
                const file = await resolveFileInput(fieldValue, fieldContentType);
                formData.append(fieldName, new Blob([bufferToBlobPart(file.buffer)], { type: file.mimeType }), file.fileName);
                continue;
            }
            if (fieldValue === undefined || fieldValue === null) {
                formData.append(fieldName, "");
            }
            else if (typeof fieldValue === "object") {
                formData.append(fieldName, JSON.stringify(fieldValue));
            }
            else {
                formData.append(fieldName, String(fieldValue));
            }
        }
        return { kind: "multipart", body: formData, headers: {} };
    }
    if (transportSpec.kind === "binary") {
        const requestJson = requestJsonOrBody;
        const hasRequestShape = !!requestJson
            && typeof requestJson === "object"
            && !Array.isArray(requestJson)
            && "requestBody" in requestJson;
        const binaryInput = hasRequestShape ? requestJson.requestBody : requestJsonOrBody;
        const file = await resolveFileInput(binaryInput, transportSpec.contentType);
        return {
            kind: "binary",
            body: file.buffer,
            headers: {
                "Content-Type": file.mimeType,
            },
        };
    }
    const requestJson = requestJsonOrBody;
    const hasRequestShape = !!requestJson
        && typeof requestJson === "object"
        && !Array.isArray(requestJson)
        && "requestBody" in requestJson;
    const jsonBody = hasRequestShape ? requestJson.requestBody : requestJsonOrBody;
    return {
        kind: "json",
        body: jsonBody,
        headers: {},
    };
}
function buildGraphQLVariables(args) {
    const variables = {};
    for (const [name, arg] of Object.entries(args)) {
        const normalized = arg.type.trim();
        const baseType = normalized.endsWith("!") ? normalized.slice(0, -1).trim() : normalized;
        if (baseType.startsWith("[") && baseType.endsWith("]")) {
            variables[name] = [];
        }
        else if (baseType === "Boolean") {
            variables[name] = false;
        }
        else if (baseType === "Int" || baseType === "Float") {
            variables[name] = 0;
        }
        else {
            variables[name] = "";
        }
    }
    return variables;
}
export async function getSchemaType(apiName) {
    const config = await loadConfig();
    const configuredSchemaType = config.apis?.[apiName]?.schemaType;
    if (configuredSchemaType === "graphql") {
        return "graphql";
    }
    if (configuredSchemaType === "openapi") {
        return "openapi";
    }
    try {
        const endpoints = await fs.readJson(getEndpointsPath(apiName));
        if (Array.isArray(endpoints) && endpoints.some((endpoint) => typeof endpoint?.rootType === "string")) {
            return "graphql";
        }
    }
    catch {
    }
    return "openapi";
}
async function readGraphQLBundledSource(apiName) {
    const bundledPath = path.join(path.dirname(getSchemasDir(apiName)), "bundled.json");
    const bundled = await fs.readJson(bundledPath);
    const sourceText = typeof bundled?.source === "string" ? bundled.source : typeof bundled?.sourceText === "string" ? bundled.sourceText : undefined;
    if (!sourceText) {
        throw new Error(`GraphQL source not found for API '${apiName}'. Run generate first.`);
    }
    return sourceText;
}
async function ensureGraphQLOperationSchema(apiName, operationId, force = false) {
    const sanitizedOperationId = await getSanitizedOperationId(apiName, operationId);
    const schemaPath = getSchemaPath(apiName, sanitizedOperationId);
    if (!force && await fs.pathExists(schemaPath)) {
        return await fs.readJson(schemaPath);
    }
    const endpoints = await fs.readJson(getEndpointsPath(apiName));
    const endpoint = endpoints.find((entry) => entry.operationId === operationId || entry.name === operationId);
    if (!endpoint) {
        throw new Error(`Endpoint '${operationId}' not found in GraphQL endpoint list.`);
    }
    const sourceText = await readGraphQLBundledSource(apiName);
    const rootType = typeof endpoint.rootType === "string" ? endpoint.rootType : typeof endpoint.method === "string" ? endpoint.method : undefined;
    if (!rootType || (rootType !== "query" && rootType !== "mutation" && rootType !== "subscription")) {
        throw new Error(`Invalid GraphQL endpoint metadata for '${operationId}'.`);
    }
    const schema = await findGraphQLEndpoint(sourceText, rootType, operationId);
    await fs.ensureDir(path.dirname(schemaPath));
    await fs.writeJson(schemaPath, schema, { spaces: 2 });
    return schema;
}
async function getOperationSchemaType(apiName) {
    return await getSchemaType(apiName);
}
export function collectRequestUpdateTypeWarnings(requestJson, requestJsonUpdates) {
    const flattenedUpdates = flattenToDotNotation(requestJsonUpdates);
    const warnings = [];
    for (const [updatePath, updateValue] of Object.entries(flattenedUpdates)) {
        if (updateValue === DELETE_SENTINEL) {
            continue;
        }
        const expectedValue = getByPath(requestJson, updatePath);
        if (expectedValue === undefined) {
            continue;
        }
        if (!matchesExpectedTemplateValue(expectedValue, updateValue)) {
            warnings.push(`--update-request type mismatch at ${updatePath}: expected ${describeValueType(expectedValue)}, received ${describeValueType(updateValue)}.`);
        }
    }
    return warnings;
}
export async function ensureResponseSchema(apiName, operationId) {
    if (await getOperationSchemaType(apiName) === "graphql") {
        const sanitizedOperationId = await getSanitizedOperationId(apiName, operationId);
        const responseSchemaPath = path.join(findRequestResponseDir(apiName, sanitizedOperationId), "response-schema.json");
        if (await fs.pathExists(responseSchemaPath)) {
            return await fs.readJson(responseSchemaPath);
        }
        const operationSchema = await ensureGraphQLOperationSchema(apiName, operationId, false);
        await fs.ensureDir(path.dirname(responseSchemaPath));
        await fs.writeJson(responseSchemaPath, operationSchema, { spaces: 2 });
        return operationSchema;
    }
    const sanitizedOperationId = await getSanitizedOperationId(apiName, operationId);
    const schemasDir = getSchemasDir(apiName);
    const operationSchema = await loadJsonObject(path.resolve(schemasDir, `${sanitizedOperationId}.json`));
    const responseDir = findRequestResponseDir(apiName, sanitizedOperationId);
    const responseSchemaPath = path.join(responseDir, "response-schema.json");
    if (await fs.pathExists(responseSchemaPath)) {
        return await fs.readJson(responseSchemaPath);
    }
    const responseSchema = getDeterministicResponseBody(operationSchema);
    if (responseSchema !== undefined) {
        await fs.ensureDir(responseDir);
        await fs.writeJson(responseSchemaPath, responseSchema, { spaces: 2 });
    }
    return responseSchema;
}
export async function makeRequest(apiName, operationId, force = false, cliHeaders, requestJsonUpdates, requestJsonWarnings, useMockUrl = false) {
    const clientSchema = await buildClientCodeSchema(apiName, operationId, await getSanitizedOperationId(apiName, operationId), force);
    const config = await loadConfig();
    const apiConfig = config.apis?.[apiName];
    const baseUrl = useMockUrl ? apiConfig?.mockUrl : apiConfig?.baseUrl;
    if (!baseUrl) {
        if (useMockUrl) {
            throw buildMockServerUnavailableError(apiName, "", `Mock URL not found in config for API '${apiName}'. Start the mock server first.`);
        }
        throw new Error("Base URL not found in config");
    }
    if (useMockUrl) {
        await ensureMockServerAvailable(apiName, baseUrl);
    }
    if (clientSchema.schemaType === "graphql") {
        const sanitizedOperationId = await getSanitizedOperationId(apiName, operationId);
        const gqlOperationSchema = await ensureGraphQLOperationSchema(apiName, operationId, force);
        const { requestJson: initialRequestJson, responseJsonPath } = await getOrCreateGraphQLRequestJson(apiName, sanitizedOperationId, force, gqlOperationSchema);
        const requestJsonPath = path.join(getSchemasDir(apiName), sanitizedOperationId, "request.json");
        let requestJson = initialRequestJson;
        const warnings = [];
        if (requestJsonWarnings && requestJsonWarnings.length > 0) {
            warnings.push(...requestJsonWarnings);
        }
        if (requestJsonUpdates && typeof requestJsonUpdates === "object" && Object.keys(requestJsonUpdates).length > 0) {
            const flattened = flattenToDotNotation(requestJsonUpdates);
            const mergedUpdates = { ...flattened };
            for (const [k, v] of Object.entries(requestJsonUpdates)) {
                if (!(k in mergedUpdates))
                    mergedUpdates[k] = v;
            }
            await updateJsonFile(requestJsonPath, mergedUpdates, 2, { deleteSentinel: DELETE_SENTINEL });
            requestJson = await fs.readJson(requestJsonPath);
        }
        const requestVariables = {
            ...buildGraphQLVariables(clientSchema.args),
            ...(isGraphQLRequestJson(requestJson) ? requestJson.variables : {}),
        };
        const requestBody = {
            query: clientSchema.query,
            variables: requestVariables,
        };
        const requestContext = {
            headers: { "Content-Type": "application/json" },
            url: "",
            warnings,
            responseJsonPath,
        };
        const httpClient = new FetchClient(baseUrl);
        let liveResponse;
        try {
            liveResponse = await httpClient.post(baseUrl, {
                headers: requestContext.headers,
                body: requestBody,
            });
            if (liveResponse && typeof liveResponse === "object" && "status" in liveResponse) {
                const status = liveResponse.status;
                if (typeof status === "number" && (status < 200 || status >= 300)) {
                    requestContext.warnings.push(`⚠️  The live HTTP request failed for ${baseUrl}: HTTP ${status}${"statusText" in liveResponse && typeof liveResponse.statusText === "string" && liveResponse.statusText ? ` ${liveResponse.statusText}` : ""}`);
                }
            }
            if (liveResponse && typeof liveResponse === "object" && Array.isArray(liveResponse.errors) && liveResponse.errors?.length) {
                requestContext.warnings.push("⚠️  GraphQL response contains errors.");
            }
            await fs.writeJson(requestContext.responseJsonPath, liveResponse, { spaces: 2 });
        }
        catch (err) {
            requestContext.warnings.push(`⚠️  The live HTTP request failed for ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
            if (!(await fs.pathExists(requestContext.responseJsonPath))) {
                requestContext.warnings.push(`response.json not found at ${requestContext.responseJsonPath}`);
                return { request: requestBody, response: undefined, warnings: requestContext.warnings };
            }
        }
        const responseJson = await fs.readJson(requestContext.responseJsonPath);
        const responseBody = unwrapResponseBody(responseJson);
        const data = responseBody && typeof responseBody === "object" && !Array.isArray(responseBody)
            ? responseBody.data
            : undefined;
        return { request: requestBody, response: data?.[clientSchema.fieldName], warnings: requestContext.warnings };
    }
    const sanitizedOperationId = await getSanitizedOperationId(apiName, operationId);
    const restSchema = await buildClientCodeSchema(apiName, operationId, sanitizedOperationId);
    if (restSchema.schemaType !== "rest") {
        throw new Error(`Invalid REST endpoint metadata for '${operationId}'.`);
    }
    const endpointSchema = await ensureEndpointSchemaFile(apiName, operationId, sanitizedOperationId, force);
    const { requestJson: initialRequestJson, responseJsonPath } = await getOrCreateRequestJson(apiName, sanitizedOperationId, force);
    const requestJsonPath = path.join(getSchemasDir(apiName), sanitizedOperationId, "request.json");
    let requestJson = initialRequestJson;
    const warnings = [];
    if (requestJsonWarnings && requestJsonWarnings.length > 0) {
        warnings.push(...requestJsonWarnings);
    }
    if (requestJsonUpdates && typeof requestJsonUpdates === "object" && Object.keys(requestJsonUpdates).length > 0) {
        const updateWarning = buildUpdateRequestWarning(requestJsonUpdates);
        if (updateWarning) {
            warnings.push(updateWarning);
        }
        const flattened = flattenToDotNotation(requestJsonUpdates);
        const mergedUpdates = { ...flattened };
        for (const [k, v] of Object.entries(requestJsonUpdates)) {
            if (!(k in mergedUpdates))
                mergedUpdates[k] = v;
        }
        await updateJsonFile(requestJsonPath, mergedUpdates, 2, { deleteSentinel: DELETE_SENTINEL });
        requestJson = await fs.readJson(requestJsonPath);
    }
    const requestContext = buildRequestContext(apiName, restSchema, requestJson, config, responseJsonPath, cliHeaders, warnings);
    const httpClient = new FetchClient(baseUrl);
    if (!restSchema.method || !restSchema.path) {
        throw new Error(`Invalid OpenAPI endpoint metadata for '${operationId}'.`);
    }
    const method = restSchema.method.toLowerCase();
    let liveResponse;
    try {
        switch (method) {
            case "get":
                liveResponse = await httpClient.get(requestContext.url, { headers: requestContext.headers });
                break;
            case "post":
                {
                    const requestBodyTransport = await buildRequestBodyTransport(endpointSchema, requestJson);
                    liveResponse = await httpClient.post(requestContext.url, {
                        headers: {
                            ...requestContext.headers,
                            ...requestBodyTransport.headers,
                        },
                        body: requestBodyTransport.body,
                    });
                }
                break;
            case "put":
                {
                    const requestBodyTransport = await buildRequestBodyTransport(endpointSchema, requestJson);
                    liveResponse = await httpClient.put(requestContext.url, {
                        headers: {
                            ...requestContext.headers,
                            ...requestBodyTransport.headers,
                        },
                        body: requestBodyTransport.body,
                    });
                }
                break;
            case "delete":
                liveResponse = await httpClient.delete(requestContext.url, { headers: requestContext.headers });
                break;
            case "patch":
                {
                    const requestBodyTransport = await buildRequestBodyTransport(endpointSchema, requestJson);
                    liveResponse = await httpClient.patch(requestContext.url, {
                        headers: {
                            ...requestContext.headers,
                            ...requestBodyTransport.headers,
                        },
                        body: requestBodyTransport.body,
                    });
                }
                break;
            case "head":
                liveResponse = await httpClient.head(requestContext.url, { headers: requestContext.headers });
                break;
            case "options":
                liveResponse = await httpClient.options(requestContext.url, { headers: requestContext.headers });
                break;
            default:
                throw new Error(`Unsupported HTTP method: ${restSchema.method}`);
        }
        if (liveResponse && typeof liveResponse === "object" && "status" in liveResponse) {
            const status = liveResponse.status;
            if (typeof status === "number" && (status < 200 || status >= 300)) {
                requestContext.warnings.push(`⚠️  The live HTTP request failed for ${baseUrl}${requestContext.url}: HTTP ${status}${"statusText" in liveResponse && typeof liveResponse.statusText === "string" && liveResponse.statusText ? ` ${liveResponse.statusText}` : ""}`);
            }
        }
        await fs.writeJson(requestContext.responseJsonPath, liveResponse, { spaces: 2 });
    }
    catch (err) {
        requestContext.warnings.push(`⚠️  The live HTTP request failed for ${baseUrl}${requestContext.url}: ${err instanceof Error ? err.message : String(err)}`);
        if (!(await fs.pathExists(requestContext.responseJsonPath))) {
            requestContext.warnings.push(`response.json not found at ${requestContext.responseJsonPath}`);
            return { request: requestJson, response: undefined, warnings: requestContext.warnings };
        }
    }
    const responseJson = await fs.readJson(requestContext.responseJsonPath);
    return { request: requestJson, response: unwrapResponseBody(responseJson), warnings: requestContext.warnings };
}
export async function validateResponse(apiName, operationId, force = false, cliHeaders, requestJsonUpdates, requestJsonWarnings, useMockUrl = false) {
    const { request, response, warnings } = await makeRequest(apiName, operationId, force, cliHeaders, requestJsonUpdates, requestJsonWarnings, useMockUrl);
    const safeWarnings = warnings ?? [];
    if (await getOperationSchemaType(apiName) === "graphql") {
        if (!response || typeof response !== "object") {
            return { valid: false, warnings: safeWarnings, errors: ["response.body missing or invalid"] };
        }
        const responseObject = response;
        if (Array.isArray(responseObject.errors) && responseObject.errors.length > 0) {
            return { valid: false, warnings: safeWarnings, errors: ["GraphQL response contains errors"] };
        }
        return { valid: true, warnings: safeWarnings };
    }
    const responseSchema = await ensureResponseSchema(apiName, operationId);
    if (responseSchema === undefined || Object.keys(responseSchema).length === 0) {
        warnings.push("No response schema found for this operation. Skipping validation.");
        return { valid: true, warnings: safeWarnings };
    }
    if (!response) {
        return { valid: false, warnings: safeWarnings };
    }
    const ajv = new Ajv({
        allErrors: true,
        strict: false,
        strictSchema: false,
        allowUnknownKeywords: true,
        removeAdditional: false
    });
    const validate = ajv.compile(responseSchema);
    const valid = validate(response);
    if (valid) {
        return { valid: true, warnings: safeWarnings };
    }
    else {
        const errors = (validate.errors || []).map((e) => {
            const path = e.instancePath ? e.instancePath.replace(/^\//, "response.body.").replace(/\//g, ".") : "response.body";
            return `${path} ${e.message}`;
        });
        return { valid: false, errors, warnings: safeWarnings };
    }
}
export async function prepareRequestTemplate(apiName, sanitizedOperationId, force = false) {
    if (await getOperationSchemaType(apiName) === "graphql") {
        const operationSchema = await ensureGraphQLOperationSchema(apiName, sanitizedOperationId, force);
        const requestJsonPath = path.join(getSchemasDir(apiName), sanitizedOperationId, "request.json");
        const responseJsonPath = path.join(findRequestResponseDir(apiName, sanitizedOperationId), "response.json");
        const requestJson = buildGraphQLArtifact(operationSchema);
        await fs.ensureDir(path.dirname(requestJsonPath));
        await fs.writeJson(requestJsonPath, requestJson, { spaces: 2 });
        return {
            requestJsonPath,
            responseJsonPath,
            requestJson,
        };
    }
    const { requestJson, responseJsonPath } = await getOrCreateRequestJson(apiName, sanitizedOperationId, force);
    const requestJsonPath = path.join(getSchemasDir(apiName), sanitizedOperationId, "request.json");
    return {
        requestJsonPath,
        responseJsonPath,
        requestJson,
    };
}
async function getOrCreateRequestJson(apiName, sanitizedOperationId, force) {
    const schemaPath = getSchemaPath(apiName, sanitizedOperationId);
    const fullSchema = await fs.readJson(schemaPath);
    const opDir = path.join(getSchemasDir(apiName), sanitizedOperationId);
    await fs.ensureDir(opDir);
    const requestJsonPath = path.join(opDir, "request.json");
    const responseJsonPath = path.join(opDir, "response.json");
    const shouldRegenerate = async () => {
        if (force || !(await fs.pathExists(requestJsonPath))) {
            return true;
        }
        const existingRequestJson = await fs.readJson(requestJsonPath);
        return !hasGeneratedRequestShape(existingRequestJson);
    };
    if (await shouldRegenerate()) {
        const template = buildDeterministicRequestTemplate(fullSchema);
        await fs.writeJson(requestJsonPath, template, { spaces: 2 });
        return {
            requestJson: template,
            responseJsonPath,
        };
    }
    return {
        requestJson: await fs.readJson(requestJsonPath),
        responseJsonPath,
    };
}
async function getOrCreateGraphQLRequestJson(apiName, sanitizedOperationId, force, operationSchema) {
    const opDir = path.join(getSchemasDir(apiName), sanitizedOperationId);
    await fs.ensureDir(opDir);
    const requestJsonPath = path.join(opDir, "request.json");
    const responseJsonPath = path.join(opDir, "response.json");
    const shouldRegenerate = async () => {
        if (force || !(await fs.pathExists(requestJsonPath))) {
            return true;
        }
        const existingRequestJson = await fs.readJson(requestJsonPath);
        return !isGraphQLRequestJson(existingRequestJson);
    };
    if (await shouldRegenerate()) {
        const template = buildGraphQLArtifact(operationSchema);
        await fs.writeJson(requestJsonPath, template, { spaces: 2 });
        return {
            requestJson: template,
            responseJsonPath,
        };
    }
    return {
        requestJson: await fs.readJson(requestJsonPath),
        responseJsonPath,
    };
}
function hasGeneratedRequestShape(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const requestJson = value;
    return Object.prototype.hasOwnProperty.call(requestJson, "parameters") && Array.isArray(requestJson.parameters);
}
function buildRequestContext(apiName, operationSchema, requestJson, config, responseJsonPath, cliHeaders, warnings = []) {
    const headers = {};
    const configHeaders = config.apis?.[apiName]?.auth?.headers;
    if (configHeaders && typeof configHeaders === "object") {
        Object.assign(headers, configHeaders);
    }
    if (cliHeaders && typeof cliHeaders === "object") {
        Object.assign(headers, cliHeaders);
    }
    const pathParams = {};
    const queryParams = {};
    for (const param of requestJson.parameters || []) {
        if (param.in === "path")
            pathParams[param.name] = param.value;
        else if (param.in === "query")
            queryParams[param.name] = param.value;
        else if (param.in === "header")
            headers[param.name] = String(param.value);
    }
    if (!operationSchema.path) {
        throw new Error(`Invalid OpenAPI endpoint metadata for '${operationSchema.operationId}'.`);
    }
    const urlPath = substitutePathParams(operationSchema.path, pathParams);
    const queryString = buildQueryString(queryParams);
    return {
        headers,
        url: urlPath + queryString,
        warnings,
        responseJsonPath,
    };
}
function buildQueryString(queryParams) {
    return Object.keys(queryParams).length
        ? "?" + Object.entries(queryParams).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")
        : "";
}
function buildDeterministicRequestTemplate(fullSchema) {
    const parametersArr = [];
    if (Array.isArray(fullSchema.parameters)) {
        for (const param of fullSchema.parameters) {
            const value = getParameterDefaultValue(param);
            parametersArr.push({ name: param.name, in: param.in, value });
        }
    }
    let requestBodyObj = null;
    if (fullSchema?.requestBody || fullSchema?.parameters) {
        requestBodyObj = getDeterministicRequestBody(fullSchema);
    }
    const requestTemplate = {
        parameters: parametersArr,
    };
    if (requestBodyObj !== null) {
        requestTemplate.requestBody = requestBodyObj;
    }
    return requestTemplate;
}
function substitutePathParams(path, params) {
    return path.replace(/\{([^}]+)\}/g, (_, key) => {
        if (!(key in params))
            throw new Error(`Missing path parameter: ${key}`);
        return encodeURIComponent(params[key]);
    });
}
export function getDeterministicRequestBody(operation) {
    const oas3Schema = extractRequestSchemaOAS3(operation);
    if (oas3Schema) {
        return buildDeterministicTemplate(oas3Schema);
    }
    const oas2Schema = extractRequestSchemaOAS2(operation);
    if (oas2Schema) {
        return buildDeterministicTemplate(oas2Schema);
    }
    return null;
}
function extractRequestSchemaOAS3(operation) {
    const content = operation?.requestBody?.content;
    if (!content || typeof content !== "object")
        return null;
    for (const contentObj of Object.values(content)) {
        const typedContent = contentObj;
        if (typedContent?.schema) {
            return typedContent.schema;
        }
    }
    return null;
}
function extractRequestSchemaOAS2(operation) {
    const params = Array.isArray(operation?.parameters) ? operation.parameters : [];
    const bodyParam = params.find((p) => p.in === "body");
    if (bodyParam?.schema) {
        const schema = bodyParam.schema;
        if (!schema.type && schema.properties) {
            schema.type = "object";
        }
        return schema;
    }
    const consumes = operation?.consumes || [];
    const isForm = consumes.includes("application/x-www-form-urlencoded") ||
        consumes.includes("multipart/form-data");
    const formParams = params.filter((p) => p.in === "formData");
    if (isForm && formParams.length) {
        const schema = { type: "object", properties: {}, required: [] };
        for (const p of formParams) {
            const prop = {};
            if (p.schema)
                Object.assign(prop, p.schema);
            else {
                if (p.type)
                    prop.type = p.type;
                if (p.items)
                    prop.items = p.items;
                if (p.format)
                    prop.format = p.format;
                if (p.enum)
                    prop.enum = p.enum;
                if (p.type === "file") {
                    prop.type = "string";
                    prop.format = "binary";
                }
            }
            schema.properties[p.name] = prop;
            if (p.required)
                schema.required.push(p.name);
        }
        if (schema.required.length === 0)
            delete schema.required;
        return schema;
    }
    return null;
}
function buildDeterministicTemplate(schema) {
    if (!schema)
        return null;
    if (schema.const !== undefined) {
        return schema.const;
    }
    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        return schema.enum[0];
    }
    if (schema.default !== undefined) {
        return schema.default;
    }
    if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
        const merged = schema.allOf
            .map((item) => buildDeterministicTemplate(item))
            .filter((value) => value !== null && value !== undefined)
            .reduce((acc, value) => mergeDeterministicValues(acc, value), {});
        if (merged !== null && merged !== undefined) {
            return merged;
        }
    }
    if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
        return selectDeterministicVariant(schema.oneOf.map((item) => buildDeterministicTemplate(item)));
    }
    if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
        return selectDeterministicVariant(schema.anyOf.map((item) => buildDeterministicTemplate(item)));
    }
    if (!schema.type && schema.properties) {
        schema.type = "object";
    }
    if (schema.$ref) {
        throw new Error("Schema contains $ref. Resolve references before building template.");
    }
    switch (schema.type) {
        case "string":
            if (schema.format === "binary") {
                return {
                    kind: "file",
                    path: "",
                    fileName: "",
                    mimeType: "",
                };
            }
            return schema.example ?? "";
        case "integer":
        case "number":
            return schema.example ?? 0;
        case "boolean":
            return schema.example ?? false;
        case "array":
            if (schema.items) {
                const itemSchema = Array.isArray(schema.items) ? schema.items[0] : schema.items;
                const itemValue = buildDeterministicTemplate(itemSchema);
                return itemValue === null || itemValue === undefined ? [] : [itemValue];
            }
            return [];
        case "object":
            const obj = {};
            if (schema.properties) {
                for (const [key, propSchema] of Object.entries(schema.properties)) {
                    obj[key] = buildDeterministicTemplate(propSchema);
                }
            }
            return obj;
        default:
            return null;
    }
}
function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function mergeDeterministicValues(left, right) {
    if (left === null || left === undefined) {
        return right;
    }
    if (right === null || right === undefined) {
        return left;
    }
    if (isPlainObject(left) && isPlainObject(right)) {
        const merged = { ...left };
        for (const [key, value] of Object.entries(right)) {
            merged[key] = key in merged ? mergeDeterministicValues(merged[key], value) : value;
        }
        return merged;
    }
    return right;
}
function selectDeterministicVariant(variants) {
    const candidates = variants.filter((value) => value !== null && value !== undefined);
    if (candidates.length === 0) {
        return null;
    }
    const objectCandidates = candidates.filter(isPlainObject);
    if (objectCandidates.length > 0) {
        return objectCandidates.reduce((best, candidate) => {
            const bestSize = Object.keys(best).length;
            const candidateSize = Object.keys(candidate).length;
            return candidateSize > bestSize ? candidate : best;
        });
    }
    return candidates[0];
}
function extractResponseSchemaOAS3(operation) {
    const responses = operation?.responses;
    if (!responses)
        return null;
    const status = responses["200"] ||
        responses["201"] ||
        responses["default"] ||
        Object.values(responses)[0];
    if (!status?.content)
        return null;
    const json = status.content["application/json"];
    if (json?.schema)
        return json.schema;
    for (const contentObj of Object.values(status.content)) {
        const typed = contentObj;
        if (typed.schema)
            return typed.schema;
    }
    return null;
}
function extractResponseSchemaOAS2(operation) {
    const responses = operation?.responses;
    if (!responses)
        return {};
    const status = responses["200"] ||
        responses["201"] ||
        responses["default"] ||
        Object.values(responses)[0];
    return status?.schema || {};
}
export function getDeterministicResponseBody(operation) {
    const oas3Schema = extractResponseSchemaOAS3(operation);
    if (oas3Schema) {
        return oas3Schema;
    }
    const oas2Schema = extractResponseSchemaOAS2(operation);
    if (oas2Schema) {
        return oas2Schema;
    }
}
export function buildDeterministicResponseValue(operation) {
    const schema = getDeterministicResponseBody(operation);
    if (!schema) {
        return null;
    }
    return buildDeterministicTemplate(schema);
}
export function buildDeterministicValueFromSchema(schema) {
    if (!schema) {
        return null;
    }
    return buildDeterministicTemplate(schema);
}
//# sourceMappingURL=validate-response.js.map