import http from "http";
import { type GraphQLEndpointRecord, type GraphQLRootType } from "./graphql.js";
type OpenApiRoute = {
    kind: "openapi";
    operationId: string;
    sanitizedOperationId: string;
    method: string;
    path: string;
    schema: Record<string, any>;
    schemaPath: string;
    responsePath: string;
    responseSchemaPath: string;
};
type GraphQLRoute = {
    kind: "graphql";
    operationId: string;
    sanitizedOperationId: string;
    name: string;
    rootType: GraphQLRootType;
    schema: GraphQLEndpointRecord;
    schemaPath: string;
    responsePath: string;
    responseSchemaPath: string;
};
type MockRoute = OpenApiRoute | GraphQLRoute;
export type MockServerContext = {
    apiName: string;
    schemaType: "openapi" | "graphql";
    routes: MockRoute[];
};
export type MockServerStartResult = {
    server: http.Server;
    mockUrl: string;
    apiName: string;
};
export declare function startMockServer(apiName: string, host?: string, port?: number): Promise<MockServerStartResult>;
export {};
