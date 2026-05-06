export function parseGetOperationFilter(expr) {
    const trimmed = expr.trim();
    if (trimmed === "count") {
        return { kind: "count" };
    }
    if (/^-?\d+$/.test(trimmed)) {
        return { kind: "index", index: Number(trimmed) };
    }
    const rangeMatch = trimmed.match(/^(-?\d*):(-?\d*)$/);
    if (rangeMatch) {
        return {
            kind: "range",
            start: rangeMatch[1] === "" ? 0 : Number(rangeMatch[1]),
            end: rangeMatch[2] === "" ? Number.POSITIVE_INFINITY : Number(rangeMatch[2]),
        };
    }
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex > 0) {
        const path = trimmed.slice(0, equalsIndex).trim();
        if (path) {
            return { kind: "path", path, value: trimmed.slice(equalsIndex + 1) };
        }
    }
    return { kind: "invalid" };
}
//# sourceMappingURL=get-operation-filter.js.map