export function parsePath(path) {
    const normalizedPath = path.replace(/\[(\d+)\]/g, ".$1");
    return normalizedPath
        .split(".")
        .filter(segment => segment.length > 0)
        .map(segment => (/^\d+$/.test(segment) ? Number(segment) : segment));
}
export function getByPath(obj, path) {
    let current = obj;
    for (const segment of parsePath(path)) {
        if (current === null || current === undefined) {
            return undefined;
        }
        if (typeof segment === "number") {
            if (!Array.isArray(current) && typeof current !== "object") {
                return undefined;
            }
            current = current[segment];
            continue;
        }
        if (typeof current !== "object") {
            return undefined;
        }
        current = current[segment];
    }
    return current;
}
export function filterArray(arr, path, expected) {
    if (!Array.isArray(arr)) {
        return arr;
    }
    return arr.filter(item => String(getByPath(item, path)) === String(expected));
}
//# sourceMappingURL=dotNotation.js.map