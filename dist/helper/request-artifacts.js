export function collectRequestJsonPaths(value, prefix = "", out = new Set()) {
    if (prefix) {
        out.add(prefix);
    }
    if (!value || typeof value !== "object") {
        return out;
    }
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index++) {
            const childPath = prefix ? `${prefix}.${index}` : `${index}`;
            collectRequestJsonPaths(value[index], childPath, out);
        }
        return out;
    }
    for (const [key, childValue] of Object.entries(value)) {
        const childPath = prefix ? `${prefix}.${key}` : key;
        collectRequestJsonPaths(childValue, childPath, out);
    }
    return out;
}
export function collectUpdateRequestKeys(value, prefix = "", out = new Set()) {
    if (!value || typeof value !== "object") {
        return out;
    }
    if (Array.isArray(value)) {
        if (prefix) {
            out.add(prefix);
        }
        return out;
    }
    for (const [key, childValue] of Object.entries(value)) {
        const childPath = prefix ? `${prefix}.${key}` : key;
        if (childValue && typeof childValue === "object" && !Array.isArray(childValue)) {
            collectUpdateRequestKeys(childValue, childPath, out);
        }
        else {
            out.add(childPath);
        }
    }
    return out;
}
export function resolveSelectedArtifact(options) {
    const selectedArtifacts = [];
    if (options.request)
        selectedArtifacts.push("request");
    if (options.response)
        selectedArtifacts.push("response");
    if (options.responseSchema)
        selectedArtifacts.push("response-schema");
    if (selectedArtifacts.length !== 1) {
        return {
            artifactName: undefined,
            error: selectedArtifacts.length === 0
                ? "Exactly one of --request, --response, or --response-schema is required."
                : "Only one of --request, --response, or --response-schema can be used at a time.",
        };
    }
    return { artifactName: selectedArtifacts[0], error: undefined };
}
//# sourceMappingURL=request-artifacts.js.map