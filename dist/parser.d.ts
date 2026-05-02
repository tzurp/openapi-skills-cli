interface ParseOpenAPIOptions {
    dereference?: boolean;
    progress?: boolean;
    rename?: string | undefined;
}
export declare function getApiName(openapiSource: string): string;
export declare function dereferenceEndpointLater(endpointSchema: Record<string, unknown>, bundledComponents: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function ensureEndpointSchemaFile(apiName: string, operationId: string, sanitizedOperationId: string, force?: boolean): Promise<Record<string, unknown>>;
declare function parseOpenAPI(openapiSource: string, baseUrl: string, options?: ParseOpenAPIOptions): Promise<string>;
export declare function validateSchema(schemaSource: string): Promise<void>;
export default parseOpenAPI;
//# sourceMappingURL=parser.d.ts.map