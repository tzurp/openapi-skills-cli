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
        const response = await fetch(finalUrl, {
            method,
            headers: {
                ...(hasBody ? { "Content-Type": "application/json" } : {}),
                ...(options.headers ?? {})
            },
            body: hasBody ? JSON.stringify(options.body) : null
        });
        const text = await response.text();
        let body = {};
        if (text.trim().length > 0) {
            try {
                body = JSON.parse(text);
            }
            catch {
                body = text;
            }
        }
        if (body !== null && typeof body === "object" && !Array.isArray(body)) {
            return {
                ...body,
                status: response.status,
                statusText: response.statusText,
            };
        }
        return {
            body,
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