import fs from "fs-extra";
import { getEndpointsPath } from "./helper/paths.js";
import { ensureEndpointSchemaFile } from "./parser.js";
import { resolveParameterSchema } from "./helper/parameter-schema.js";
function toPascalCase(str) {
    return str
        .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
        .replace(/^[a-z]/, c => c.toUpperCase());
}
function extractEnums(schema, enums, prefix) {
    if (!schema || typeof schema !== "object")
        return;
    if (Array.isArray(schema.enum)) {
        const enumName = toPascalCase(prefix);
        enums[enumName] = schema.enum;
    }
    if (schema.properties && typeof schema.properties === "object") {
        for (const [key, value] of Object.entries(schema.properties)) {
            extractEnums(value, enums, `${prefix}_${key}`);
        }
    }
    if (schema.items) {
        extractEnums(schema.items, enums, `${prefix}_item`);
    }
    if (schema.oneOf)
        schema.oneOf.forEach((s, i) => extractEnums(s, enums, `${prefix}_oneOf_${i}`));
    if (schema.anyOf)
        schema.anyOf.forEach((s, i) => extractEnums(s, enums, `${prefix}_anyOf_${i}`));
    if (schema.allOf)
        schema.allOf.forEach((s, i) => extractEnums(s, enums, `${prefix}_allOf_${i}`));
}
function removeXml(schema) {
    if (!schema || typeof schema !== "object")
        return;
    delete schema.xml;
    if (schema.properties && typeof schema.properties === "object") {
        for (const value of Object.values(schema.properties)) {
            removeXml(value);
        }
    }
    if (schema.items)
        removeXml(schema.items);
    if (schema.oneOf)
        schema.oneOf.forEach(removeXml);
    if (schema.anyOf)
        schema.anyOf.forEach(removeXml);
    if (schema.allOf)
        schema.allOf.forEach(removeXml);
}
function findSuccessResponse(responses) {
    if (!responses || typeof responses !== "object")
        return null;
    const statusKeys = Object.keys(responses).filter(k => /^\d{3}$/.test(k));
    const successKey = statusKeys.find(k => k.startsWith("2"));
    if (!successKey)
        return null;
    return responses[successKey];
}
function findJsonContent(content) {
    if (!content || typeof content !== "object")
        return null;
    const entry = Object.entries(content).find(([ct]) => ct.toLowerCase().includes("json"));
    return entry ? entry[1] : null;
}
function extractSuccessSchema(responses) {
    const success = findSuccessResponse(responses);
    if (!success || !success.content)
        return null;
    const json = findJsonContent(success.content);
    if (!json || !json.schema)
        return null;
    return json.schema;
}
const defaultErrorSchema = {
    type: "object",
    properties: {
        message: { type: "string" },
        status: { type: "number" }
    }
};
function extractErrorSchemas(responses) {
    const result = {};
    if (!responses || typeof responses !== "object")
        return result;
    for (const [status, resp] of Object.entries(responses)) {
        if (!/^\d{3}$/.test(status))
            continue;
        if (status.startsWith("2"))
            continue;
        const content = resp.content;
        const json = content ? findJsonContent(content) : null;
        const schema = json && json.schema ? json.schema : defaultErrorSchema;
        result[status] = schema;
    }
    return result;
}
function normalizeParams(grouped, operationId) {
    const flat = {};
    for (const location of ["path", "query", "header"]) {
        for (const [name, p] of Object.entries(grouped[location] || {})) {
            flat[name] = {
                ...p.schema,
                required: p.required ?? false,
                description: p.description,
                in: location
            };
        }
    }
    return {
        typeName: `${toPascalCase(operationId)}Params`,
        schema: flat
    };
}
export async function buildClientCodeSchema(apiName, operationId, sanitizedOperationId) {
    const endpoints = await fs.readJson(getEndpointsPath(apiName));
    const endpoint = endpoints.find((ep) => ep.operationId === operationId);
    if (!endpoint) {
        throw new Error(`Endpoint with operationId '${operationId}' not found.`);
    }
    const schema = await ensureEndpointSchemaFile(apiName, operationId, sanitizedOperationId);
    const groupedParams = {
        path: {},
        query: {},
        header: {}
    };
    for (const p of (schema.parameters || [])) {
        if (p.in === "path" || p.in === "query" || p.in === "header") {
            groupedParams[p.in][p.name] = {
                description: p.description,
                required: p.required,
                schema: resolveParameterSchema(p)
            };
        }
    }
    const successSchema = extractSuccessSchema(schema.responses);
    const enums = {};
    if (successSchema) {
        removeXml(successSchema);
        extractEnums(successSchema, enums, `${operationId}_response`);
    }
    const params = normalizeParams(groupedParams, operationId);
    const errorSchemas = extractErrorSchemas(schema.responses);
    let requestBodySchema = null;
    const requestBody = schema.requestBody;
    if (requestBody && requestBody.content) {
        const json = findJsonContent(requestBody.content);
        if (json && json.schema) {
            requestBodySchema = json.schema;
            removeXml(requestBodySchema);
            extractEnums(requestBodySchema, enums, `${operationId}_request`);
        }
    }
    const responseTypeName = toPascalCase(operationId.replace(/^(get|post|put|delete|patch|head|options)/i, "") || operationId);
    return {
        operationId,
        method: endpoint.method,
        path: endpoint.path,
        deprecated: endpoint.deprecated ?? schema.deprecated ?? false,
        params,
        response: successSchema
            ? { typeName: responseTypeName, schema: successSchema }
            : null,
        requestBody: requestBodySchema
            ? {
                typeName: `${toPascalCase(operationId)}Request`,
                schema: requestBodySchema
            }
            : null,
        errors: errorSchemas,
        enums
    };
}
//# sourceMappingURL=client-schema-builder.js.map