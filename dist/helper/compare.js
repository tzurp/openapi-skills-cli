import { ensureEndpointsFile, ensureEndpointSchemaFile } from "../parser.js";
import { getSanitizedOperationId } from "./endpoint-utils.js";
function normalizeApiNames(apiNames) {
    if (Array.isArray(apiNames)) {
        return apiNames
            .filter((value) => typeof value === "string")
            .map(value => value.trim())
            .filter((value) => value.length > 0);
    }
    if (typeof apiNames === "string" && apiNames.trim().length > 0) {
        return [apiNames.trim()];
    }
    return [];
}
function pickOperationId(endpoint) {
    if (typeof endpoint.operationId === "string" && endpoint.operationId.trim().length > 0) {
        return endpoint.operationId;
    }
    if (typeof endpoint.name === "string" && endpoint.name.trim().length > 0) {
        return endpoint.name;
    }
    return "";
}
function pickTag(endpoint) {
    if (typeof endpoint.tag === "string" && endpoint.tag.trim().length > 0) {
        return endpoint.tag.trim();
    }
    if (Array.isArray(endpoint.tags)) {
        const firstTag = endpoint.tags.find((tag) => typeof tag === "string" && tag.trim().length > 0);
        if (firstTag) {
            return firstTag.trim();
        }
    }
    return undefined;
}
function normalizeEndpoint(endpoint) {
    const operationId = pickOperationId(endpoint);
    if (!operationId) {
        return null;
    }
    const normalized = {
        operationId,
    };
    if (typeof endpoint.method === "string" && endpoint.method.trim().length > 0) {
        normalized.method = endpoint.method.trim();
    }
    if (typeof endpoint.path === "string" && endpoint.path.trim().length > 0) {
        normalized.path = endpoint.path.trim();
    }
    const tag = pickTag(endpoint);
    if (tag) {
        normalized.tag = tag;
    }
    if (typeof endpoint.rootType === "string" && endpoint.rootType.trim().length > 0) {
        normalized.rootType = endpoint.rootType.trim();
    }
    if (Array.isArray(endpoint.tags)) {
        normalized.tags = endpoint.tags.filter((tag) => typeof tag === "string" && tag.trim().length > 0).map(tag => tag.trim());
    }
    return normalized;
}
function operationSurfaceToMap(operation) {
    return {
        operationId: operation.operationId,
        method: operation.method ?? null,
        path: operation.path ?? null,
        tag: operation.tag ?? null,
        rootType: operation.rootType ?? null,
    };
}
function diffOperationSurfaces(left, right) {
    const leftMap = operationSurfaceToMap(left);
    const rightMap = operationSurfaceToMap(right);
    const fields = ["operationId", "method", "path", "tag", "rootType"];
    const changes = [];
    for (const field of fields) {
        if (leftMap[field] !== rightMap[field]) {
            changes.push({
                field,
                before: leftMap[field],
                after: rightMap[field],
            });
        }
    }
    return changes;
}
function toPointerPath(segments) {
    if (segments.length === 0) {
        return "/";
    }
    return `/${segments
        .map(segment => String(segment).replace(/~/g, "~0").replace(/\//g, "~1"))
        .join("/")}`;
}
function decodePointerSegment(segment) {
    return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}
function getValueByPointer(root, pointer) {
    if (pointer === "" || pointer === "/") {
        return root;
    }
    const segments = pointer.split("/").slice(1).map(decodePointerSegment);
    let current = root;
    for (const segment of segments) {
        if (Array.isArray(current)) {
            const index = Number(segment);
            if (!Number.isInteger(index) || index < 0 || index >= current.length) {
                return undefined;
            }
            current = current[index];
            continue;
        }
        if (!current || typeof current !== "object") {
            return undefined;
        }
        current = current[segment];
    }
    return current;
}
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function diffValues(left, right, path = [], out = []) {
    if (Object.is(left, right)) {
        return out;
    }
    const leftIsObject = isPlainObject(left);
    const rightIsObject = isPlainObject(right);
    const leftIsArray = Array.isArray(left);
    const rightIsArray = Array.isArray(right);
    if (leftIsArray && rightIsArray) {
        const maxLength = Math.max(left.length, right.length);
        for (let index = 0; index < maxLength; index += 1) {
            const nextPath = [...path, index];
            if (index >= left.length) {
                out.push({ path: toPointerPath(nextPath), kind: "added", after: right[index] });
                continue;
            }
            if (index >= right.length) {
                out.push({ path: toPointerPath(nextPath), kind: "removed", before: left[index] });
                continue;
            }
            diffValues(left[index], right[index], nextPath, out);
        }
        return out;
    }
    if (leftIsObject && rightIsObject) {
        const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
        for (const key of keys) {
            const nextPath = [...path, key];
            if (!(key in left)) {
                out.push({ path: toPointerPath(nextPath), kind: "added", after: right[key] });
                continue;
            }
            if (!(key in right)) {
                out.push({ path: toPointerPath(nextPath), kind: "removed", before: left[key] });
                continue;
            }
            diffValues(left[key], right[key], nextPath, out);
        }
        return out;
    }
    out.push({
        path: toPointerPath(path),
        kind: "changed",
        before: left,
        after: right,
    });
    return out;
}
async function loadEndpoints(apiName) {
    const endpoints = await ensureEndpointsFile(apiName);
    if (!Array.isArray(endpoints)) {
        throw new Error(`Invalid endpoints.json for API '${apiName}'.`);
    }
    return endpoints;
}
async function loadNormalizedOperation(apiName, operationId) {
    await ensureEndpointsFile(apiName);
    const sanitizedOperationId = await getSanitizedOperationId(apiName, operationId);
    if (!sanitizedOperationId) {
        throw new Error(`OperationId '${operationId}' was not found for API '${apiName}'.`);
    }
    const schema = await ensureEndpointSchemaFile(apiName, operationId, sanitizedOperationId);
    if (!schema || typeof schema !== "object") {
        throw new Error(`Could not load schema for operation '${operationId}' in API '${apiName}'.`);
    }
    return {
        sanitizedOperationId,
        schema,
    };
}
function extractSuccessSchema(responses) {
    if (!responses || typeof responses !== "object" || Array.isArray(responses)) {
        return null;
    }
    const responseEntries = Object.entries(responses);
    const successKey = responseEntries.find(([status]) => /^\d{3}$/.test(status) && status.startsWith("2"))?.[0];
    if (!successKey) {
        return null;
    }
    const successResponse = responses[successKey];
    if (!successResponse || typeof successResponse !== "object") {
        return null;
    }
    if (successResponse.content && typeof successResponse.content === "object") {
        const jsonContent = Object.entries(successResponse.content).find(([contentType]) => contentType.toLowerCase().includes("json"))?.[1];
        if (jsonContent && typeof jsonContent === "object" && jsonContent.schema && typeof jsonContent.schema === "object") {
            return jsonContent.schema;
        }
    }
    if (successResponse.schema && typeof successResponse.schema === "object") {
        return successResponse.schema;
    }
    return null;
}
function summarizeOperationList(endpoints) {
    return endpoints
        .map(endpoint => normalizeEndpoint(endpoint))
        .filter((endpoint) => endpoint !== null);
}
function isSchemaDiffLikelyBreaking(diff, leftSchema, rightSchema) {
    const breakingPathPatterns = [
        /\/type$/,
        /\/format$/,
        /\/enum$/,
        /\/items(\/|$)/,
        /\/oneOf(\/|$)/,
        /\/anyOf(\/|$)/,
        /\/allOf(\/|$)/,
        /\/additionalProperties$/,
        /\/required(\/|$)/,
    ];
    const matchesBreakingPattern = breakingPathPatterns.some(pattern => pattern.test(diff.path));
    if (!matchesBreakingPattern) {
        return null;
    }
    if (diff.kind === "removed") {
        return {
            path: diff.path,
            reason: "Removed schema structure or constraint.",
        };
    }
    if (diff.kind === "changed") {
        return {
            path: diff.path,
            reason: "Changed schema structure or constraint.",
        };
    }
    if (diff.kind === "added") {
        const parentPath = diff.path.replace(/\/[^/]+$/, "");
        const rightParent = getValueByPointer(rightSchema, parentPath);
        const leftParent = getValueByPointer(leftSchema, parentPath);
        const addedKey = diff.path.split("/").pop() ? decodePointerSegment(diff.path.split("/").pop()) : "";
        if (isPlainObject(rightParent) && Array.isArray(rightParent.required) && rightParent.required.includes(addedKey)) {
            return {
                path: diff.path,
                reason: "Added required schema property.",
            };
        }
        if (isPlainObject(leftParent) && Array.isArray(leftParent.required) && leftParent.required.includes(addedKey)) {
            return {
                path: diff.path,
                reason: "Added field is required by the target schema.",
            };
        }
    }
    return null;
}
function detectBreakingOperationChanges(result) {
    const breaking = [];
    for (const removed of result.removed) {
        breaking.push({
            path: removed.operationId,
            reason: "Operation was removed.",
        });
    }
    for (const modified of result.modified) {
        for (const change of modified.changes) {
            if (change.field === "method" || change.field === "path" || change.field === "rootType") {
                breaking.push({
                    path: `${modified.operationId}.${change.field}`,
                    reason: "Endpoint contract changed.",
                });
            }
        }
    }
    return breaking;
}
function detectBreakingSchemaChanges(leftSchema, rightSchema, differences) {
    const breaking = [];
    for (const diff of differences) {
        const result = isSchemaDiffLikelyBreaking(diff, leftSchema, rightSchema);
        if (result) {
            breaking.push(result);
        }
    }
    return breaking;
}
export async function resolveComparePlan(apiNames, operationNames, options) {
    const normalizedApis = normalizeApiNames(apiNames);
    const normalizedOperationNames = operationNames.map(operationName => operationName.trim()).filter(operationName => operationName.length > 0);
    if (normalizedApis.length !== 2) {
        return { error: { message: "Compare requires exactly two --api flags." } };
    }
    const [apiA, apiB] = normalizedApis;
    if (options.operations) {
        return {
            plan: {
                mode: "operations",
                apiA,
                apiB,
            },
        };
    }
    if (typeof options.op === "string" && options.op.trim().length > 0) {
        return {
            plan: {
                mode: "schemas",
                apiA,
                apiB,
                operationA: options.op.trim(),
                operationB: options.op.trim(),
            },
        };
    }
    if (normalizedOperationNames.length === 2) {
        return {
            plan: {
                mode: "schemas",
                apiA,
                apiB,
                operationA: normalizedOperationNames[0],
                operationB: normalizedOperationNames[1],
            },
        };
    }
    if (normalizedOperationNames.length === 0) {
        return { error: { message: "Compare requires either --operations or an operation name for both APIs." } };
    }
    return { error: { message: "Compare requires operation names for both APIs unless --op is provided." } };
}
export async function compareOperationLists(apiA, apiB) {
    const [leftEndpoints, rightEndpoints] = await Promise.all([loadEndpoints(apiA), loadEndpoints(apiB)]);
    const leftOperations = summarizeOperationList(leftEndpoints);
    const rightOperations = summarizeOperationList(rightEndpoints);
    const leftById = new Map(leftOperations.map(operation => [operation.operationId, operation]));
    const rightById = new Map(rightOperations.map(operation => [operation.operationId, operation]));
    const allIds = new Set([...leftById.keys(), ...rightById.keys()]);
    const added = [];
    const removed = [];
    const modified = [];
    for (const operationId of Array.from(allIds).sort((a, b) => a.localeCompare(b))) {
        const left = leftById.get(operationId);
        const right = rightById.get(operationId);
        if (!left && right) {
            added.push(right);
            continue;
        }
        if (left && !right) {
            removed.push(left);
            continue;
        }
        if (left && right) {
            const changes = diffOperationSurfaces(left, right);
            if (changes.length > 0) {
                modified.push({
                    operationId,
                    changes,
                    left,
                    right,
                });
            }
        }
    }
    return { added, removed, modified };
}
export async function compareSchemas(apiA, operationA, apiB, operationB) {
    const [leftOperation, rightOperation] = await Promise.all([
        loadNormalizedOperation(apiA, operationA),
        loadNormalizedOperation(apiB, operationB),
    ]);
    const leftSchema = extractSuccessSchema(leftOperation.schema.responses) ?? {};
    const rightSchema = extractSuccessSchema(rightOperation.schema.responses) ?? {};
    const differences = diffValues(leftSchema, rightSchema);
    const breakingChanges = detectBreakingSchemaChanges(leftSchema, rightSchema, differences);
    return {
        left: {
            apiName: apiA,
            operationId: operationA,
            sanitizedOperationId: leftOperation.sanitizedOperationId,
        },
        right: {
            apiName: apiB,
            operationId: operationB,
            sanitizedOperationId: rightOperation.sanitizedOperationId,
        },
        differences,
        breakingChanges,
    };
}
export function getCompareBreakingChanges(result) {
    if ("added" in result && "removed" in result && "modified" in result) {
        return detectBreakingOperationChanges(result);
    }
    return result.breakingChanges;
}
function colorize(text, colorCode, enabled) {
    if (!enabled) {
        return text;
    }
    return `\x1b[${colorCode}m${text}\x1b[0m`;
}
function formatOperationSurface(operation) {
    const method = operation.method?.toUpperCase();
    const path = operation.path ?? operation.rootType ?? "";
    const suffix = method && path ? ` (${method} ${path})` : path ? ` (${path})` : "";
    return `${operation.operationId}${suffix}`;
}
export function renderCompareOperations(result, useColor) {
    const breaking = getCompareBreakingChanges(result);
    const lines = [];
    const green = (text) => colorize(text, "32", useColor);
    const red = (text) => colorize(text, "31", useColor);
    const yellow = (text) => colorize(text, "33", useColor);
    const cyan = (text) => colorize(text, "36", useColor);
    lines.push(cyan("=== Compare Summary ==="));
    lines.push(`Added: ${green(String(result.added.length))}  Removed: ${red(String(result.removed.length))}  Modified: ${yellow(String(result.modified.length))}`);
    if (breaking.length > 0) {
        lines.push(red(`Breaking changes: ${breaking.length}`));
    }
    else {
        lines.push(green("Breaking changes: none detected"));
    }
    if (result.added.length > 0) {
        lines.push("");
        lines.push(green("=== Added Operations ==="));
        for (const item of result.added) {
            lines.push(green(`+ ${formatOperationSurface(item)}`));
        }
    }
    if (result.removed.length > 0) {
        lines.push("");
        lines.push(red("=== Removed Operations ==="));
        for (const item of result.removed) {
            lines.push(red(`- ${formatOperationSurface(item)}`));
        }
    }
    if (result.modified.length > 0) {
        lines.push("");
        lines.push(yellow("=== Modified Operations ==="));
        for (const item of result.modified) {
            lines.push(yellow(item.operationId));
            for (const change of item.changes) {
                const marker = change.field === "method" || change.field === "path" || change.field === "rootType" ? red("*") : yellow("*");
                lines.push(`  ${marker} ${change.field} changed ${String(change.before)} → ${String(change.after)}`);
            }
        }
    }
    if (breaking.length > 0) {
        lines.push("");
        lines.push(red("=== Breaking Changes ==="));
        for (const item of breaking) {
            lines.push(red(`! ${item.path}: ${item.reason}`));
        }
    }
    return lines;
}
export function renderCompareSchemas(result, useColor) {
    const green = (text) => colorize(text, "32", useColor);
    const red = (text) => colorize(text, "31", useColor);
    const yellow = (text) => colorize(text, "33", useColor);
    const cyan = (text) => colorize(text, "36", useColor);
    const lines = [];
    lines.push(cyan("=== Compare Summary ==="));
    lines.push(`Differences: ${yellow(String(result.differences.length))}`);
    if (result.breakingChanges.length > 0) {
        lines.push(red(`Breaking changes: ${result.breakingChanges.length}`));
    }
    else {
        lines.push(green("Breaking changes: none detected"));
    }
    if (result.differences.length > 0) {
        lines.push("");
        lines.push(yellow("=== Schema Differences ==="));
        for (const diff of result.differences) {
            const label = diff.kind === "added" ? green("+") : diff.kind === "removed" ? red("-") : yellow("~");
            lines.push(`${label} ${diff.path}`);
        }
    }
    if (result.breakingChanges.length > 0) {
        lines.push("");
        lines.push(red("=== Breaking Changes ==="));
        for (const item of result.breakingChanges) {
            lines.push(red(`! ${item.path}: ${item.reason}`));
        }
    }
    return lines;
}
//# sourceMappingURL=compare.js.map