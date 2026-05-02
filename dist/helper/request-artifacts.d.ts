export type OperationArtifactName = "request" | "response" | "response-schema";
export declare function resolveSelectedArtifact(options: {
    request?: boolean;
    response?: boolean;
    responseSchema?: boolean;
}): {
    artifactName: OperationArtifactName | undefined;
    error: string | undefined;
};
//# sourceMappingURL=request-artifacts.d.ts.map