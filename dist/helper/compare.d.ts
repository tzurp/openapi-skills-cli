export type ComparePlan = {
    mode: "operations";
    apiA: string;
    apiB: string;
} | {
    mode: "schemas";
    apiA: string;
    apiB: string;
    operationA: string;
    operationB: string;
};
export type ComparePlanError = {
    message: string;
};
type NormalizedOperationSurface = {
    operationId: string;
    method?: string;
    path?: string;
    tag?: string;
    rootType?: string;
    tags?: string[];
};
export type OperationChange = {
    field: "operationId" | "method" | "path" | "tag" | "rootType";
    before: string | null;
    after: string | null;
};
export type ModifiedOperation = {
    operationId: string;
    changes: OperationChange[];
    left: NormalizedOperationSurface;
    right: NormalizedOperationSurface;
};
export type CompareOperationsResult = {
    added: NormalizedOperationSurface[];
    removed: NormalizedOperationSurface[];
    modified: ModifiedOperation[];
};
export type StructuralDiff = {
    path: string;
    kind: "added" | "removed" | "changed";
    before?: unknown;
    after?: unknown;
};
export type CompareSchemasResult = {
    left: {
        apiName: string;
        operationId: string;
        sanitizedOperationId: string;
    };
    right: {
        apiName: string;
        operationId: string;
        sanitizedOperationId: string;
    };
    differences: StructuralDiff[];
    breakingChanges: BreakingChange[];
};
export type BreakingChange = {
    path: string;
    reason: string;
};
export declare function resolveComparePlan(apiNames: unknown, operationNames: string[], options: {
    op?: string;
    operations?: boolean;
}): Promise<{
    plan?: ComparePlan;
    error?: ComparePlanError;
}>;
export declare function compareOperationLists(apiA: string, apiB: string): Promise<CompareOperationsResult>;
export declare function compareSchemas(apiA: string, operationA: string, apiB: string, operationB: string): Promise<CompareSchemasResult>;
export declare function getCompareBreakingChanges(result: CompareOperationsResult | CompareSchemasResult): BreakingChange[];
export declare function renderCompareOperations(result: CompareOperationsResult, useColor: boolean): string[];
export declare function renderCompareSchemas(result: CompareSchemasResult, useColor: boolean): string[];
export {};
