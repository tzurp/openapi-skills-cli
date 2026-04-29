type ConfigField = "version" | "baseUrl" | "authHeaders" | "vars";
type UpdateConfigOptions = {
    version?: string;
    openapiSource?: string;
    baseUrl?: string;
    auth?: Record<string, string>;
    vars?: Record<string, string>;
    removeApi?: boolean;
};
export type DeleteApiResult = {
    ok: true;
    message: string;
    data: {
        removedApi: string;
    };
} | {
    ok: false;
    error: {
        type: string;
        message: string;
    };
};
export interface ApiConfig {
    version?: string;
    openapiSource?: string;
    baseUrl?: string;
    auth?: {
        headers?: Record<string, string>;
    };
    vars?: Record<string, string>;
}
export interface ConfigType {
    apis: Record<string, ApiConfig>;
}
export declare function loadConfig(): Promise<ConfigType>;
export declare function ensureConfig(): Promise<void>;
export declare function updateConfig(apiName: string, options?: UpdateConfigOptions): Promise<void>;
export declare function deleteApi(apiName: string): Promise<DeleteApiResult>;
export declare function getConfigValue(apiName: string, key: ConfigField): Promise<string | Record<string, string> | [string, string][] | undefined>;
export declare function listEndpoints(apiName: string): Promise<Array<Record<string, any>>>;
export declare function listApis(): Promise<string[]>;
export {};
//# sourceMappingURL=index.d.ts.map