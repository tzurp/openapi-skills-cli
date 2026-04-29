# Shared Fetch Client Helper

Copy this file to `tests/fetch-client.ts` and instantiate `FetchClient` in your generated tests.

```typescript
export interface HttpRequestOptionsBase {
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
}

export interface HttpRequestWithBodyOptions extends HttpRequestOptionsBase {
  body?: any;
}

export interface HttpClient {
  // Methods WITHOUT body
  get<T = unknown>(url: string, options?: HttpRequestOptionsBase): Promise<T>;
  head<T = unknown>(url: string, options?: HttpRequestOptionsBase): Promise<T>;
  options<T = unknown>(url: string, options?: HttpRequestOptionsBase): Promise<T>;
  // Methods WITH body
  post<T = unknown>(url: string, options?: HttpRequestWithBodyOptions): Promise<T>;
  put<T = unknown>(url: string, options?: HttpRequestWithBodyOptions): Promise<T>;
  patch<T = unknown>(url: string, options?: HttpRequestWithBodyOptions): Promise<T>;
  delete<T = unknown>(url: string, options?: HttpRequestWithBodyOptions): Promise<T>;
}

/**
 * PLAYWRIGHT ADAPTATION NOTE:
 *
 * This FetchClient is written for Node's global `fetch()`, but it can be
 * switched to Playwright's APIRequestContext by replacing the fetch call.
 *
 * To enable Playwright mode:
 * 1. Pass a Playwright `APIRequestContext` into the constructor:
 *      new FetchClient(baseUrl, requestContext)
 *
 * 2. Replace:
 *        fetch(finalUrl, { method, headers, body })
 *    With:
 *        requestContext.fetch(finalUrl, {
 *          method,
 *          headers,
 *          data: body,   // Playwright uses `data` instead of `body`
 *        })
 *
 * 3. Playwright response fields are functions:
 *        response.status()      instead of response.status
 *        response.statusText()  instead of response.statusText
 *
 * 4. The rest of the client stays the same — only the fetch call changes.
 *
 * This allows the same client to work in both environments:
 * - Node/Vitest → uses global fetch()
 * - Playwright → uses requestContext.fetch()
 */

export class FetchClient implements HttpClient {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(
    method: string,
    path: string,
    options: HttpRequestOptionsBase | HttpRequestWithBodyOptions = {}
  ): Promise<T> {
    const finalUrl = this.baseUrl.replace(/\/$/, "") + "/" + path.replace(/^\//, "");

    const hasBody =
      "body" in options &&
      options.body !== undefined &&
      method !== "GET" &&
      method !== "HEAD";

    const response = await fetch(finalUrl, {
      method,
      headers: {
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...(options.headers ?? {})
      },
      body: hasBody ? JSON.stringify((options as HttpRequestWithBodyOptions).body) : null
    });

    const text = await response.text();
    let body: unknown = {};

    if (text.trim().length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
      return {
        ...body,
        status: response.status,
        statusText: response.statusText,
      } as T;
    }

    return {
      body,
      status: response.status,
      statusText: response.statusText,
    } as T;
  }

  get<T>(path: string, options?: HttpRequestOptionsBase): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  head<T>(path: string, options?: HttpRequestOptionsBase): Promise<T> {
    return this.request<T>("HEAD", path, options);
  }

  options<T>(path: string, options?: HttpRequestOptionsBase): Promise<T> {
    return this.request<T>("OPTIONS", path, options);
  }

  post<T>(path: string, options?: HttpRequestWithBodyOptions): Promise<T> {
    return this.request<T>("POST", path, options);
  }

  put<T>(path: string, options?: HttpRequestWithBodyOptions): Promise<T> {
    return this.request<T>("PUT", path, options);
  }

  patch<T>(path: string, options?: HttpRequestWithBodyOptions): Promise<T> {
    return this.request<T>("PATCH", path, options);
  }

  delete<T>(path: string, options?: HttpRequestWithBodyOptions): Promise<T> {
    return this.request<T>("DELETE", path, options);
  }
}
```# Shared Fetch Client Helper

Copy this file to `tests/fetch-client.ts` and instantiate `FetchClient` in your generated tests.

```typescript
export interface HttpRequestOptionsBase {
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
}

export interface HttpRequestWithBodyOptions extends HttpRequestOptionsBase {
  body?: any;
}

export interface HttpClient {
  // Methods WITHOUT body
  get<T = unknown>(url: string, options?: HttpRequestOptionsBase): Promise<T>;
  head<T = unknown>(url: string, options?: HttpRequestOptionsBase): Promise<T>;
  options<T = unknown>(url: string, options?: HttpRequestOptionsBase): Promise<T>;
  // Methods WITH body
  post<T = unknown>(url: string, options?: HttpRequestWithBodyOptions): Promise<T>;
  put<T = unknown>(url: string, options?: HttpRequestWithBodyOptions): Promise<T>;
  patch<T = unknown>(url: string, options?: HttpRequestWithBodyOptions): Promise<T>;
  delete<T = unknown>(url: string, options?: HttpRequestWithBodyOptions): Promise<T>;
}

/**
 * NOTE: To use Playwright's APIRequestContext instead of fetch:
 * - Replace `fetch(...)` with `requestContext.fetch(...)`
 * - Use `response.status()` / `response.statusText()` instead of properties (`response.status` / `response.statusText`)
 * - Pass request bodies via `data:` instead of `body:`
 * - Create the request context once (await request.newContext({ baseURL }))
 * This class can be adapted by swapping the fetch call with Playwright's client.
 */
export class FetchClient implements HttpClient {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(
    method: string,
    path: string,
    options: HttpRequestOptionsBase | HttpRequestWithBodyOptions = {}
  ): Promise<T> {
    const finalUrl = this.baseUrl.replace(/\/$/, "") + "/" + path.replace(/^\//, "");

    const hasBody =
      "body" in options &&
      options.body !== undefined &&
      method !== "GET" &&
      method !== "HEAD";

    const response = await fetch(finalUrl, {
      method,
      headers: {
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...(options.headers ?? {})
      },
      body: hasBody ? JSON.stringify((options as HttpRequestWithBodyOptions).body) : null
    });

    const text = await response.text();
    let body: unknown = {};

    if (text.trim().length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
      return {
        ...body,
        status: response.status,
        statusText: response.statusText,
      } as T;
    }

    return {
      body,
      status: response.status,
      statusText: response.statusText,
    } as T;
  }

  get<T>(path: string, options?: HttpRequestOptionsBase): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  head<T>(path: string, options?: HttpRequestOptionsBase): Promise<T> {
    return this.request<T>("HEAD", path, options);
  }

  options<T>(path: string, options?: HttpRequestOptionsBase): Promise<T> {
    return this.request<T>("OPTIONS", path, options);
  }

  post<T>(path: string, options?: HttpRequestWithBodyOptions): Promise<T> {
    return this.request<T>("POST", path, options);
  }

  put<T>(path: string, options?: HttpRequestWithBodyOptions): Promise<T> {
    return this.request<T>("PUT", path, options);
  }

  patch<T>(path: string, options?: HttpRequestWithBodyOptions): Promise<T> {
    return this.request<T>("PATCH", path, options);
  }

  delete<T>(path: string, options?: HttpRequestWithBodyOptions): Promise<T> {
    return this.request<T>("DELETE", path, options);
  }
}
```
