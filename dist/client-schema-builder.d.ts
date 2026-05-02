export interface ClientCodeSchema {
    operationId: string;
    method: string;
    path: string;
    deprecated: boolean;
    params: {
        typeName: string;
        schema: Record<string, any>;
    };
    response: {
        typeName: string;
        schema: any;
    } | null;
    requestBody: null | {
        typeName: string;
        schema: any;
    };
    errors: Record<string, any>;
    enums: Record<string, string[]>;
}
export declare function buildClientCodeSchema(apiName: string, operationId: string, sanitizedOperationId: string, force?: boolean): Promise<ClientCodeSchema>;
//# sourceMappingURL=client-schema-builder.d.ts.map