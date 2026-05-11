export interface ClientCodeSchema {
    schemaType: "rest";
    operationId: string;
    method: string | null;
    path: string | null;
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
export interface GraphQLClientCodeSchema {
    schemaType: "graphql";
    fieldName: string;
    rootType: "query" | "mutation" | "subscription";
    args: Record<string, {
        type: string;
        required: boolean;
    }>;
    returnType: string;
    query: string;
}
type BuildClientCodeSchemaResult = ClientCodeSchema | GraphQLClientCodeSchema;
export declare function buildClientCodeSchema(apiName: string, operationId: string, sanitizedOperationId: string, force?: boolean): Promise<BuildClientCodeSchemaResult>;
export {};
//# sourceMappingURL=client-schema-builder.d.ts.map