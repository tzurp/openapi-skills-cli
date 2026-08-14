export class FetchClient {
    baseUrl;
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }
    async request(method, path, options = {}) {
        if (!/^https?:\/\//i.test(this.baseUrl)) {
            throw new Error(`Invalid baseUrl: "${this.baseUrl}". Must include http:// or https://`);
        }
        const base = this.baseUrl.endsWith("/")
            ? this.baseUrl
            : this.baseUrl + "/";
        const finalUrl = new URL(path.replace(/^\//, ""), base).toString();
        const hasBody = "body" in options &&
            options.body !== undefined &&
            method !== "GET" &&
            method !== "HEAD";
        const headers = new Headers(options.headers ?? {});
        let body = null;
        if (hasBody) {
            const requestBody = options.body;
            const isFormData = typeof FormData !== "undefined" && requestBody instanceof FormData;
            const isBlob = typeof Blob !== "undefined" && requestBody instanceof Blob;
            const isArrayBuffer = requestBody instanceof ArrayBuffer || ArrayBuffer.isView(requestBody);
            const isBuffer = typeof Buffer !== "undefined" && Buffer.isBuffer(requestBody);
            if (isFormData) {
                headers.delete("Content-Type");
                body = requestBody;
            }
            else if (isBlob || isArrayBuffer || isBuffer || typeof requestBody === "string") {
                body = requestBody;
            }
            else {
                if (!headers.has("Content-Type")) {
                    headers.set("Content-Type", "application/json");
                }
                body = JSON.stringify(requestBody);
            }
        }
        const response = await fetch(finalUrl, {
            method,
            headers,
            body
        });
        const text = await response.text();
        let responseBody = {};
        if (text.trim().length > 0) {
            try {
                responseBody = JSON.parse(text);
            }
            catch {
                responseBody = text;
            }
        }
        if (responseBody !== null && typeof responseBody === "object" && !Array.isArray(responseBody)) {
            return {
                ...responseBody,
                status: response.status,
                statusText: response.statusText,
            };
        }
        return {
            body: responseBody,
            status: response.status,
            statusText: response.statusText,
        };
    }
    get(path, options) {
        return this.request("GET", path, options);
    }
    head(path, options) {
        return this.request("HEAD", path, options);
    }
    options(path, options) {
        return this.request("OPTIONS", path, options);
    }
    post(path, options) {
        return this.request("POST", path, options);
    }
    put(path, options) {
        return this.request("PUT", path, options);
    }
    patch(path, options) {
        return this.request("PATCH", path, options);
    }
    delete(path, options) {
        return this.request("DELETE", path, options);
    }
}
//# sourceMappingURL=http-client.js.map