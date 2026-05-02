import fs from "fs-extra";
import { ensureEndpointSchemaFile } from "../parser.js";
import { listApis } from "../index.js";
import { getSanitizedOperationId } from "./endpoint-utils.js";
import { findRequestResponseDir } from "./paths.js";
import { prepareRequestTemplate } from "../validate-response.js";
export function getRequestResponseMetadata(apiName, operationId) {
    const requestResponseDir = findRequestResponseDir(apiName, operationId);
    const fileCount = fs.existsSync(requestResponseDir)
        ? fs.readdirSync(requestResponseDir).length
        : 0;
    return {
        fileCount,
    };
}
export async function resolveMultiOperationIds(apiName, operationIds) {
    const seen = new Set();
    const duplicates = new Set();
    for (const operationId of operationIds) {
        if (seen.has(operationId)) {
            duplicates.add(operationId);
        }
        seen.add(operationId);
    }
    if (duplicates.size > 0) {
        throw new Error(`Duplicate operationId(s) are not allowed in prepare-only mode: ${Array.from(duplicates).join(", ")}`);
    }
    const apis = await listApis();
    if (!Array.isArray(apis) || !apis.includes(apiName)) {
        throw new Error(`API '${apiName}' is not installed. Run generate first.`);
    }
    const resolved = [];
    for (const operationId of operationIds) {
        const sanitizedOperationId = await getSanitizedOperationId(apiName, operationId);
        if (!sanitizedOperationId) {
            throw new Error(`OperationId '${operationId}' was not found for API '${apiName}'.`);
        }
        resolved.push({ operationId, sanitizedOperationId });
    }
    return resolved;
}
export async function prepareMultiOperationRequests(apiName, operationIds, force = false) {
    const resolvedOperationIds = await resolveMultiOperationIds(apiName, operationIds);
    const operations = [];
    for (const { operationId, sanitizedOperationId } of resolvedOperationIds) {
        await ensureEndpointSchemaFile(apiName, operationId, sanitizedOperationId);
        await prepareRequestTemplate(apiName, sanitizedOperationId, force);
        const metadata = getRequestResponseMetadata(apiName, sanitizedOperationId);
        operations.push({
            kind: "request-result",
            apiName,
            operationId,
            sanitizedOperationId,
            preparedOnly: true,
            request: null,
            response: null,
            warnings: [],
            ...metadata,
        });
    }
    const summaryLines = [
        `Prepared request templates for ${operations.length} operations:`,
        "",
        ...operations.map(operation => `  ✓ ${operation.operationId}`),
        "",
        "No live requests were executed.",
        "Use `openapi-skills request <operationId> --force --update-request ...` with only flattened object dot-notation keys to run each step.",
    ];
    const payload = {
        kind: "request-result",
        apiName,
        preparedOnly: true,
        operationIds,
        summary: summaryLines,
        message: "No live requests were executed.",
        hint: "Use `openapi-skills request <operationId> --force --update-request ...` with only flattened object dot-notation keys to run each step.",
        operations,
    };
    return {
        operations,
        summaryText: summaryLines.join("\n"),
        payload,
    };
}
//# sourceMappingURL=request-preparation.js.map