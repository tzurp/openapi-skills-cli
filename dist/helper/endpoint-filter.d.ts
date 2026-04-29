export declare function sliceEndpointsByIndex<T>(items: T[], range?: string): T[];
export declare function filterEndpoints(endpoints: Array<Record<string, any>>, opts: {
    path?: string | string[];
    filter?: string;
    method?: string;
    operationId?: string;
}): Array<Record<string, any>>;
export declare function anyEndpointMatches(endpoints: Array<Record<string, any>>, opts: {
    path?: string | string[];
    filter?: string;
    method?: string;
}): boolean;
//# sourceMappingURL=endpoint-filter.d.ts.map