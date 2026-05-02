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