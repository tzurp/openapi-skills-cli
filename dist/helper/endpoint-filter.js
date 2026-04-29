function parseClauses(value) {
    const orGroups = value
        .trim()
        .toLowerCase()
        .split("|")
        .map(group => group.trim())
        .filter(Boolean)
        .map(group => group.split(/\s+/).filter(Boolean));
    return { orGroups };
}
function matchesClause(text, clause) {
    if (clause.orGroups.length === 0) {
        return true;
    }
    return clause.orGroups.some(group => group.every(term => text.includes(term)));
}
function normalizePathSegments(rawPath) {
    return rawPath
        .split("/")
        .map(segment => segment.trim().toLowerCase())
        .filter(Boolean)
        .flatMap(segment => {
        if (segment.startsWith("{") && segment.endsWith("}")) {
            const unwrapped = segment.slice(1, -1).trim();
            return unwrapped ? [segment, unwrapped] : [segment];
        }
        return [segment];
    });
}
function matchesPathToken(endpointPath, token) {
    if (!token) {
        return true;
    }
    if (token === ":param") {
        return /\{[^/{}]+\}/.test(endpointPath);
    }
    if (token.startsWith("/")) {
        return endpointPath.startsWith(token);
    }
    const segments = normalizePathSegments(endpointPath);
    return segments.includes(token);
}
function matchesPathClause(endpointPath, clause) {
    const normalizedClause = parseClauses(clause);
    return normalizedClause.orGroups.some(group => group.every(token => matchesPathToken(endpointPath, token)));
}
function normalizePathInputs(pathInput) {
    if (!pathInput) {
        return [];
    }
    return (Array.isArray(pathInput) ? pathInput : [pathInput]).map(value => value.trim()).filter(Boolean);
}
function sliceByInclusiveRange(items, range) {
    if (typeof range !== "string" || range.trim().length === 0 || range.trim() === ":") {
        return items;
    }
    const trimmed = range.trim();
    const singleIndexMatch = trimmed.match(/^-?\d+$/);
    const rangeMatch = trimmed.match(/^(-?\d*)?:(-?\d*)?$/);
    let start;
    let end;
    if (singleIndexMatch) {
        start = Number(trimmed);
        end = start;
    }
    else if (rangeMatch) {
        const rawStart = rangeMatch[1];
        const rawEnd = rangeMatch[2];
        start = rawStart === undefined || rawStart === "" ? 0 : Number(rawStart);
        end = rawEnd === undefined || rawEnd === "" ? items.length - 1 : Number(rawEnd);
    }
    else {
        throw new Error(`Invalid --index value: ${range}`);
    }
    if (Number.isNaN(start) || Number.isNaN(end)) {
        throw new Error(`Invalid --index value: ${range}`);
    }
    const normalizeIndex = (index) => (index < 0 ? items.length + index : index);
    const normalizedStart = normalizeIndex(start);
    const normalizedEnd = normalizeIndex(end);
    if (items.length === 0) {
        return [];
    }
    const clampedStart = Math.max(0, normalizedStart);
    const clampedEnd = Math.min(items.length - 1, normalizedEnd);
    if (clampedStart > clampedEnd) {
        return [];
    }
    return items.slice(clampedStart, clampedEnd + 1);
}
export function sliceEndpointsByIndex(items, range) {
    return sliceByInclusiveRange(items, range);
}
export function filterEndpoints(endpoints, opts) {
    let filtered = endpoints;
    if (opts.operationId) {
        const operationId = opts.operationId.toLowerCase();
        filtered = filtered.filter(e => (e.operationId || "").toLowerCase() === operationId);
    }
    if (opts.method) {
        const method = opts.method.toLowerCase();
        filtered = filtered.filter(e => (e.method || "").toLowerCase() === method);
    }
    const pathClauses = normalizePathInputs(opts.path);
    if (pathClauses.length > 0) {
        filtered = filtered.filter(endpoint => {
            const endpointPath = (endpoint.path || "").toString().toLowerCase();
            return pathClauses.every(clause => matchesPathClause(endpointPath, clause));
        });
    }
    if (opts.filter) {
        const filterClause = parseClauses(opts.filter);
        filtered = filtered.filter(ep => {
            const fields = [ep.operationId, ep.method, ep.path, ep.summary, ep.description]
                .map(f => (f || "").toString().toLowerCase())
                .join(" ");
            return matchesClause(fields, filterClause);
        });
    }
    return filtered;
}
export function anyEndpointMatches(endpoints, opts) {
    return filterEndpoints(endpoints, opts).length > 0;
}
//# sourceMappingURL=endpoint-filter.js.map