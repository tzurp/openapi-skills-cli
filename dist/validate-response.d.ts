import { type Updates } from "./helper/json-updater.js";
type RequestJson = {
    parameters?: Array<{
        name: string;
        in: "path" | "query" | "header";
        value: unknown;
    }> | null;
    requestBody?: unknown;
};
type MakeRequestResult = {
    request: any;
    response: any;
    warnings?: string[];
};
export declare function makeRequest(apiName: string, operationId: string, force?: boolean, cliHeaders?: Record<string, string>, requestJsonUpdates?: Updates): Promise<MakeRequestResult>;
export declare function validateResponse(apiName: string, operationId: string, force?: boolean, cliHeaders?: Record<string, string>, requestJsonUpdates?: Updates): Promise<{
    valid: boolean;
    errors?: string[];
    warnings?: string[];
}>;
export declare function prepareRequestTemplate(apiName: string, sanitizedOperationId: string, force?: boolean): Promise<{
    requestJsonPath: string;
    responseJsonPath: string;
    requestJson: RequestJson;
}>;
export declare function getDeterministicRequestBody(operation: any): any;
export declare function getDeterministicResponseBody(operation: any): any;
export {};
//# sourceMappingURL=validate-response.d.ts.map