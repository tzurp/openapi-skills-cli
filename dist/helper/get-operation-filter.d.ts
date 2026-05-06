export type GetOperationFilterResult = {
    kind: "count";
} | {
    kind: "index";
    index: number;
} | {
    kind: "range";
    start: number;
    end: number;
} | {
    kind: "path";
    path: string;
    value: string;
} | {
    kind: "invalid";
};
export declare function parseGetOperationFilter(expr: string): GetOperationFilterResult;
//# sourceMappingURL=get-operation-filter.d.ts.map