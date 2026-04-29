export interface HttpRequestOptionsBase {
    headers?: Record<string, string>;
    query?: Record<string, string | number | boolean | undefined>;
}
export interface HttpRequestWithBodyOptions extends HttpRequestOptionsBase {
    body?: any;
}
export interface HttpClient {
    get<T = unknown>(url: string, options?: HttpRequestOptionsBase): Promise<T>;
    head<T = unknown>(url: string, options?: HttpRequestOptionsBase): Promise<T>;
    options<T = unknown>(url: string, options?: HttpRequestOptionsBase): Promise<T>;
    post<T = unknown>(url: string, options?: HttpRequestWithBodyOptions): Promise<T>;
    put<T = unknown>(url: string, options?: HttpRequestWithBodyOptions): Promise<T>;
    patch<T = unknown>(url: string, options?: HttpRequestWithBodyOptions): Promise<T>;
    delete<T = unknown>(url: string, options?: HttpRequestWithBodyOptions): Promise<T>;
}
export declare class FetchClient implements HttpClient {
    private readonly baseUrl;
    constructor(baseUrl: string);
    private request;
    get<T>(path: string, options?: HttpRequestOptionsBase): Promise<T>;
    head<T>(path: string, options?: HttpRequestOptionsBase): Promise<T>;
    options<T>(path: string, options?: HttpRequestOptionsBase): Promise<T>;
    post<T>(path: string, options?: HttpRequestWithBodyOptions): Promise<T>;
    put<T>(path: string, options?: HttpRequestWithBodyOptions): Promise<T>;
    patch<T>(path: string, options?: HttpRequestWithBodyOptions): Promise<T>;
    delete<T>(path: string, options?: HttpRequestWithBodyOptions): Promise<T>;
}
//# sourceMappingURL=http-client.d.ts.map