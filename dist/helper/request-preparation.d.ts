export type RequestResponseMetadata = {
    fileCount: number;
};
export type PreparedRequestOperation = RequestResponseMetadata & {
    kind: "request-result";
    apiName: string;
    operationId: string;
    sanitizedOperationId: string;
    preparedOnly: true;
    request: null;
    response: null;
    warnings: string[];
};
export declare function getRequestResponseMetadata(apiName: string, operationId: string): RequestResponseMetadata;
export declare function resolveMultiOperationIds(apiName: string, operationIds: string[]): Promise<Array<{
    operationId: string;
    sanitizedOperationId: string;
}>>;
export declare function prepareMultiOperationRequests(apiName: string, operationIds: string[], force?: boolean): Promise<{
    operations: PreparedRequestOperation[];
    summaryText: string;
    payload: Record<string, unknown>;
}>;
//# sourceMappingURL=request-preparation.d.ts.map