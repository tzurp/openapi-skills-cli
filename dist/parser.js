import SwaggerParser from "@apidevtools/swagger-parser";
import $RefParser from "@apidevtools/json-schema-ref-parser";
import fs from "fs-extra";
import path from "path";
import { updateConfig } from "./index.js";
import { getApiDir, getBundledPath, getComponentsPath, getSchemaPath, getSchemasDir } from "./helper/paths.js";
import { isInteractive, logger } from "./helper/logger.js";
import { sanitizeOperationPath } from "./helper/sanitizer.js";
export function getApiName(openapiSource) {
    let base;
    try {
        const url = new URL(openapiSource);
        base = path.basename(url.pathname, path.extname(url.pathname));
    }
    catch {
        base = path.basename(openapiSource, path.extname(openapiSource));
    }
    return sanitizeOperationPath(base || "api");
}
function isCircularReferenceError(error) {
    if (error instanceof Error) {
        return /circular/i.test(error.message) || /circular/i.test(error.name);
    }
    if (typeof error === "object" && error !== null) {
        const message = String(error.message ?? "");
        const name = String(error.name ?? "");
        return /circular/i.test(message) || /circular/i.test(name);
    }
    return false;
}
function removeCycles(obj, seen = new WeakSet()) {
    if (obj && typeof obj === "object") {
        if (seen.has(obj)) {
            return undefined;
        }
        seen.add(obj);
        if (Array.isArray(obj)) {
            const cleanedArray = obj.map(item => removeCycles(item, seen));
            seen.delete(obj);
            return cleanedArray;
        }
        const cleanedObject = {};
        for (const [key, value] of Object.entries(obj)) {
            const cleanedValue = removeCycles(value, seen);
            if (cleanedValue !== undefined) {
                cleanedObject[key] = cleanedValue;
            }
        }
        seen.delete(obj);
        return cleanedObject;
    }
    return obj;
}
function findEndpointInPaths(pathsObject, operationId) {
    for (const [pathKey, methods] of Object.entries(pathsObject)) {
        for (const [method, operation] of Object.entries(methods)) {
            if (operation && typeof operation === "object" && "operationId" in operation) {
                const typedOperation = operation;
                if (typedOperation.operationId === operationId) {
                    return {
                        pathKey,
                        method,
                        operation: typedOperation,
                    };
                }
            }
        }
    }
    return undefined;
}
export async function dereferenceEndpointLater(endpointSchema, bundledComponents) {
    const operationId = typeof endpointSchema.operationId === "string" ? endpointSchema.operationId : "unknown-operation";
    const method = typeof endpointSchema.method === "string" ? endpointSchema.method.toUpperCase() : "GET";
    const endpointPath = typeof endpointSchema.path === "string" ? endpointSchema.path : "unknown-path";
    const shouldShowProgress = isInteractive;
    if (shouldShowProgress) {
        logger.progressLine(`Dereferencing endpoint ${operationId} (${method} ${endpointPath})...`);
    }
    const sourceDocument = {
        openapi: "3.0.0",
        paths: {
            "/temp": {
                get: endpointSchema,
            },
        },
        definitions: bundledComponents,
        components: bundledComponents,
    };
    const dereferenced = await $RefParser.dereference(sourceDocument, {
        mutateInputSchema: false,
        dereference: { circular: "ignore" },
    });
    const cleaned = removeCycles(dereferenced);
    const tempPath = cleaned.paths;
    const tempOperation = tempPath && typeof tempPath === "object" ? tempPath["/temp"] : undefined;
    const tempGet = tempOperation && typeof tempOperation === "object" ? tempOperation.get : undefined;
    if (tempGet && typeof tempGet === "object") {
        if (shouldShowProgress) {
            logger.progressLine(`Endpoint ${operationId} (${method} ${endpointPath}) dereference complete.`);
        }
        return tempGet;
    }
    if (shouldShowProgress) {
        logger.progressLine(`Endpoint ${operationId} (${method} ${endpointPath}) dereference complete.`);
    }
    return cleaned;
}
export async function ensureEndpointSchemaFile(apiName, operationId, sanitizedOperationId) {
    const schemaPath = getSchemaPath(apiName, sanitizedOperationId);
    if (await fs.pathExists(schemaPath)) {
        return fs.readJson(schemaPath);
    }
    const bundledPath = getBundledPath(apiName);
    const componentsPath = getComponentsPath(apiName);
    const bundled = await fs.readJson(bundledPath);
    if (!bundled || typeof bundled !== "object" || !("paths" in bundled)) {
        throw new Error(`Bundled OpenAPI document not found for API '${apiName}'. Run generate first.`);
    }
    let bundledComponents = {};
    const bundledComponentsValue = bundled.components;
    const bundledDefinitionsValue = bundled.definitions;
    if (bundledComponentsValue && typeof bundledComponentsValue === "object" && !Array.isArray(bundledComponentsValue)) {
        bundledComponents = bundledComponentsValue;
    }
    else if (bundledDefinitionsValue && typeof bundledDefinitionsValue === "object" && !Array.isArray(bundledDefinitionsValue)) {
        bundledComponents = bundledDefinitionsValue;
    }
    else if (await fs.pathExists(componentsPath)) {
        bundledComponents = (await fs.readJson(componentsPath));
    }
    const match = findEndpointInPaths(bundled.paths, operationId);
    if (!match) {
        throw new Error(`Endpoint '${operationId}' not found in bundled OpenAPI document.`);
    }
    const endpointSchema = {
        operationId,
        method: match.method,
        path: match.pathKey,
        ...match.operation,
    };
    const dereferencedSchema = await dereferenceEndpointLater(endpointSchema, bundledComponents);
    await fs.ensureDir(path.dirname(schemaPath));
    await fs.writeJson(schemaPath, dereferencedSchema, { spaces: 2 });
    return dereferencedSchema;
}
async function loadOpenAPIDocument(openapiSource, dereference) {
    if (!dereference) {
        return SwaggerParser.bundle(openapiSource);
    }
    try {
        return await SwaggerParser.dereference(openapiSource, {
            dereference: { circular: false },
        });
    }
    catch (error) {
        if (isCircularReferenceError(error)) {
            throw new Error("The --dereference flag cannot be used because this OpenAPI spec contains circular references. Try running without --dereference.");
        }
        throw error;
    }
}
function detectOpenApiVersion(doc) {
    if (typeof doc.swagger === "string" && doc.swagger.startsWith("2.")) {
        return "2";
    }
    if (typeof doc.openapi === "string" && doc.openapi.startsWith("3.")) {
        return "3";
    }
    return "2";
}
async function parseOpenAPI(openapiSource, baseUrl, options = {}) {
    let apiName = "";
    let version = "unknown";
    let api;
    const showProgressSignal = options.progress !== false && isInteractive;
    try {
        if (showProgressSignal) {
            logger.progressLine(`Loading OpenAPI document from ${openapiSource}...`);
        }
        api = await loadOpenAPIDocument(openapiSource, options.dereference === true);
        if (showProgressSignal) {
            logger.progressLine("OpenAPI document load complete.");
        }
    }
    catch (error) {
        logger.error(`Error during parsing OpenAPI schema: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
    if (typeof api !== "object" || !api.paths) {
        throw new Error("Invalid OpenAPI schema: Missing 'paths'");
    }
    try {
        version = detectOpenApiVersion(api);
        apiName = options.rename || getApiName(openapiSource);
        const apiDir = getApiDir(apiName);
        await fs.remove(apiDir);
        const schemasDir = getSchemasDir(apiName);
        await fs.ensureDir(schemasDir);
        const bundledPath = getBundledPath(apiName);
        await fs.writeJson(bundledPath, api, { spaces: 2 });
        if (!options.dereference) {
            const componentsPath = getComponentsPath(apiName);
            await fs.writeJson(componentsPath, api?.components ?? {}, { spaces: 2 });
        }
        const endpoints = [];
        let totalEndpoints = 0;
        let processed = 0;
        const shouldShowProgress = options.progress !== false && isInteractive;
        for (const [pathKey, methods] of Object.entries(api.paths)) {
            for (const [method, operation] of Object.entries(methods)) {
                if (operation && typeof operation === "object" && "operationId" in operation) {
                    const typedOperation = operation;
                    if (typedOperation.operationId) {
                        totalEndpoints += 1;
                    }
                }
            }
        }
        for (const [pathKey, methods] of Object.entries(api.paths)) {
            for (const [method, operation] of Object.entries(methods)) {
                if (operation && typeof operation === "object" && "operationId" in operation) {
                    const typedOperation = operation;
                    if (typedOperation.operationId) {
                        const endpointSummary = {
                            operationId: typedOperation.operationId,
                            sanitizedOperationId: sanitizeOperationPath(typedOperation.operationId),
                            method,
                            path: pathKey,
                        };
                        if (typedOperation.summary !== undefined) {
                            endpointSummary.summary = typedOperation.summary;
                        }
                        if (typedOperation.description !== undefined) {
                            endpointSummary.description = typedOperation.description;
                        }
                        endpoints.push(endpointSummary);
                        processed += 1;
                        if (shouldShowProgress) {
                            logger.progress(`\rProcessed ${processed}/${totalEndpoints}`);
                        }
                    }
                }
            }
        }
        if (shouldShowProgress && totalEndpoints > 0) {
            logger.progressLine("");
        }
        try {
            const endpointsPath = path.join(apiDir, "endpoints.json");
            await fs.writeJson(endpointsPath, endpoints, { spaces: 2 });
        }
        catch (error) {
            logger.error(`Error writing endpoints.json: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
        try {
            await updateConfig(apiName, { baseUrl, openapiSource, version });
            const baseUrlText = baseUrl ? "with baseUrl" : "without baseUrl";
            logger.info(`Schema '${apiName}' added to config.json ${baseUrlText} and openapiSource recorded.`);
        }
        catch (error) {
            logger.error(`Error updating config.json: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
        logger.info(`Parsing complete. Schemas and endpoints.json generated under ${apiDir}`);
    }
    catch (error) {
        logger.error(`Error during OpenAPI schema processing: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
    return apiName;
}
export async function validateSchema(schemaSource) {
    try {
        await SwaggerParser.validate(schemaSource);
        return;
    }
    catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error));
    }
}
export default parseOpenAPI;
//# sourceMappingURL=parser.js.map