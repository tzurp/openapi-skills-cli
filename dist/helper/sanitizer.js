export function sanitizeOperationPath(name) {
    const normalized = name
        .normalize("NFKD")
        .replace(/[\\/]/g, "_");
    const segments = normalized.split("_");
    const sanitizedSegments = segments.map(seg => {
        if (seg === "") {
            return "_";
        }
        seg = seg.replace(/\./g, "_");
        seg = seg.replace(/[^a-zA-Z0-9_-]/g, "_");
        seg = seg.replace(/^_+|_+$/g, "");
        return seg || "_";
    });
    return sanitizedSegments.join("_");
}
//# sourceMappingURL=sanitizer.js.map