import type { GraphQLEndpointRecord } from "./graphql.js";
export declare function omitOpenApiEmptyOptionalFields(requestJson: unknown, operationSchema: unknown): boolean;
export declare function omitGraphQLEmptyOptionalFields(requestJson: unknown, operationSchema: GraphQLEndpointRecord): boolean;
