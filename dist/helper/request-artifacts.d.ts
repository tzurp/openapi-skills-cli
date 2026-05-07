export type OperationArtifactName = "request" | "response" | "response-schema";
export declare function collectRequestJsonPaths(value: unknown, prefix?: string, out?: Set<string>): Set<string>;
export declare function collectUpdateRequestKeys(value: unknown, prefix?: string, out?: Set<string>): Set<string>;
export declare function resolveSelectedArtifact(options: {
    request?: boolean;
    response?: boolean;
    responseSchema?: boolean;
}): {
    artifactName: OperationArtifactName | undefined;
    error: string | undefined;
};
//# sourceMappingURL=request-artifacts.d.ts.map