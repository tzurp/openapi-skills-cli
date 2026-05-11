export type GraphQLRootType = "query" | "mutation" | "subscription";
export type GraphQLTypeDescriptor = {
    kind: "scalar" | "enum" | "object" | "input-object" | "list" | "non-null" | "unknown";
    typeName: string;
    fields?: Record<string, GraphQLTypeDescriptor>;
    ofType?: GraphQLTypeDescriptor;
    enumValues?: string[];
    defaultValue?: unknown;
    required?: boolean;
    circular?: string;
};
export type GraphQLEndpointRecord = {
    name: string;
    operationId: string;
    sanitizedOperationId: string;
    rootType: GraphQLRootType;
    method: string | null;
    path: string | null;
    summary?: string;
    description?: string;
    args: Record<string, GraphQLTypeDescriptor>;
    returns: GraphQLTypeDescriptor;
};
export type GraphQLArtifact = {
    query: string;
    variables: Record<string, unknown>;
};
export declare function loadSourceText(source: string): Promise<string>;
export declare function isGraphQL(text: string): boolean;
export declare function extractGraphQLEndpoints(sourceText: string): GraphQLEndpointRecord[];
export declare function findGraphQLEndpoint(sourceText: string, rootType: GraphQLRootType, fieldName: string): GraphQLEndpointRecord;
export declare function buildGraphQLArtifact(endpoint: GraphQLEndpointRecord): GraphQLArtifact;
export declare function buildGraphQLOperationSchema(endpoint: GraphQLEndpointRecord): GraphQLEndpointRecord;
export declare function getGraphQLRootTypeFromMethod(method: string): GraphQLRootType | undefined;
export declare function isGraphQLTypeName(typeName: string): boolean;
export declare function defaultValueForDescriptor(descriptor: GraphQLTypeDescriptor): unknown;
export declare function typeStringForDescriptor(descriptor: GraphQLTypeDescriptor): string;
export declare function selectionSetForDescriptor(descriptor: GraphQLTypeDescriptor): string;
export declare function descriptorIsLeaf(descriptor: GraphQLTypeDescriptor): boolean;
//# sourceMappingURL=graphql.d.ts.map