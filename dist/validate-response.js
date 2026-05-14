import { FetchClient } from "./helper/http-client.js";
import fs from "fs-extra";
import path from "path";
import { getSchemaPath, getSchemasDir, findRequestResponseDir } from "./helper/paths.js";
import Ajv from "ajv";
import { buildClientCodeSchema } from "./client-schema-builder.js";
import { DELETE_SENTINEL, loadJsonObject, updateJsonFile } from "./helper/json-updater.js";
import { loadConfig } from "./index.js";
import getSanitizedOperationId from "./helper/endpoint-utils.js";
import { getParameterDefaultValue } from "./helper/parameter-schema.js";
import { getByPath } from "./helper/dotNotation.js";
import { buildGraphQLArtifact, extractGraphQLEndpoints, findGraphQLEndpoint } from "./helper/graphql.js";
import { getEndpointsPath } from "./helper/paths.js";
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
    if (Array.isArray(value)) {
        return "array";
    }
    return typeof value;
}
function matchesExpectedTemplateValue(expectedValue, actualValue) {
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
export async function makeRequest(apiName, operationId, force = false, cliHeaders, requestJsonUpdates, requestJsonWarnings) {
    const clientSchema = await buildClientCodeSchema(apiName, operationId, await getSanitizedOperationId(apiName, operationId), force);
    const config = await loadConfig();
    const baseUrl = config.apis?.[apiName]?.baseUrl;
    if (!baseUrl)
        throw new Error("Base URL not found in config");
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
        return { request: requestBody, response: responseJson?.data?.[clientSchema.fieldName], warnings: requestContext.warnings };
    }
    const sanitizedOperationId = await getSanitizedOperationId(apiName, operationId);
    const restSchema = await buildClientCodeSchema(apiName, operationId, sanitizedOperationId);
    if (restSchema.schemaType !== "rest") {
        throw new Error(`Invalid REST endpoint metadata for '${operationId}'.`);
    }
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
                liveResponse = await httpClient.post(requestContext.url, {
                    headers: requestContext.headers,
                    body: requestJson.requestBody,
                });
                break;
            case "put":
                liveResponse = await httpClient.put(requestContext.url, {
                    headers: requestContext.headers,
                    body: requestJson.requestBody,
                });
                break;
            case "delete":
                liveResponse = await httpClient.delete(requestContext.url, { headers: requestContext.headers });
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
    return { request: requestJson, response: responseJson, warnings: requestContext.warnings };
}
export async function validateResponse(apiName, operationId, force = false, cliHeaders, requestJsonUpdates, requestJsonWarnings) {
    const { request, response, warnings } = await makeRequest(apiName, operationId, force, cliHeaders, requestJsonUpdates, requestJsonWarnings);
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
    const headers = { "Content-Type": "application/json" };
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
    if (!schema.type && schema.properties) {
        schema.type = "object";
    }
    if (schema.$ref) {
        throw new Error("Schema contains $ref. Resolve references before building template.");
    }
    switch (schema.type) {
        case "string":
            return schema.example ?? "";
        case "integer":
        case "number":
            return schema.example ?? 0;
        case "boolean":
            return schema.example ?? false;
        case "array":
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
//# sourceMappingURL=validate-response.js.map