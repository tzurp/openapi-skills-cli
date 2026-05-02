import { FetchClient } from "./helper/http-client.js";
import fs from "fs-extra";
import path from "path";
import { getSchemaPath, getSchemasDir, findRequestResponseDir } from "./helper/paths.js";
import Ajv from "ajv";
import { buildClientCodeSchema } from "./client-schema-builder.js";
import { loadJsonObject, updateJsonFile } from "./helper/json-updater.js";
import { loadConfig } from "./index.js";
import getSanitizedOperationId from "./helper/endpoint-utils.js";
import { getParameterDefaultValue } from "./helper/parameter-schema.js";
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
export async function makeRequest(apiName, operationId, force = false, cliHeaders, requestJsonUpdates) {
    const sanitizedOperationId = await getSanitizedOperationId(apiName, operationId);
    const operationSchema = await buildClientCodeSchema(apiName, operationId, sanitizedOperationId);
    const config = await loadConfig();
    const baseUrl = config.apis?.[apiName]?.baseUrl;
    if (!baseUrl)
        throw new Error("Base URL not found in config");
    const { requestJson: initialRequestJson, responseJsonPath } = await getOrCreateRequestJson(apiName, sanitizedOperationId, force);
    const requestJsonPath = path.join(getSchemasDir(apiName), sanitizedOperationId, "request.json");
    let requestJson = initialRequestJson;
    const warnings = [];
    if (requestJsonUpdates && typeof requestJsonUpdates === "object" && Object.keys(requestJsonUpdates).length > 0) {
        const updateWarning = buildUpdateRequestWarning(requestJsonUpdates);
        if (updateWarning) {
            warnings.push(updateWarning);
        }
        await updateJsonFile(requestJsonPath, requestJsonUpdates);
        requestJson = await fs.readJson(requestJsonPath);
    }
    const requestContext = buildRequestContext(apiName, operationSchema, requestJson, config, responseJsonPath, cliHeaders, warnings);
    const httpClient = new FetchClient(baseUrl);
    const method = operationSchema.method.toLowerCase();
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
                throw new Error(`Unsupported HTTP method: ${operationSchema.method}`);
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
export async function validateResponse(apiName, operationId, force = false, cliHeaders, requestJsonUpdates) {
    const { request, response, warnings } = await makeRequest(apiName, operationId, force, cliHeaders, requestJsonUpdates);
    const sanitizedOperationId = await getSanitizedOperationId(apiName, operationId);
    const opDir = getSchemasDir(apiName);
    const operationSchema = await loadJsonObject(path.resolve(opDir, `${sanitizedOperationId}.json`));
    const responseSchema = getDeterministicResponseBody(operationSchema);
    const responseSchemaPath = path.join(findRequestResponseDir(apiName, sanitizedOperationId), "response-schema.json");
    await fs.ensureDir(opDir);
    if (responseSchema !== undefined) {
        await fs.writeJson(responseSchemaPath, responseSchema, { spaces: 2 });
    }
    const safeWarnings = warnings ?? [];
    if (responseSchema === undefined) {
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