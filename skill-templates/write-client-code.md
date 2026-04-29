# Scenario: Write Client Code for an Endpoint

**Goal:** Generate TypeScript client code for a specific endpoint using OpenAPI metadata.

## Workflow

1. **Ensure API is parsed:** Run `openapi-skills get-api-names` to verify API exists, or run `openapi-skills generate <spec-source> --base-url <url> --no-progress --rename<newApiName>` if needed.
2. **Find operationId:** Run `openapi-skills list --api <apiName> --method <METHOD> --path <prefix> --filter<pattern> --index<range|position>` to locate the desired endpoint and its `operationId`.
3. **Get schema:** Run `openapi-skills generate-client-schema <operationId> --api <apiName>` to retrieve structured metadata for code generation.
4. **Generate client code:** Using the schema output, write the TypeScript client class following the rules in this document.

**Example:**
```bash
openapi-skills generate-client-schema addPet --api petstore
```

---

## Scope

**Generate:** TypeScript class with typed methods, interfaces for parameters and responses, JSDoc comments describing each method.

**Do NOT generate:** Usage examples showing how to instantiate or call the client. Users will write their own usage code.

## Generated Code Structure

### File Header

All generated client code must begin with:
```typescript
/**
 * <API Name> Client
 * Generated from <apiName> OpenAPI schema by openapi-skills.
 */
```

Substitute placeholders:
- `<API Name>`: Human-readable API name (e.g., "Petstore" or "GitHub")
- `<operationId>`: The endpoint operation ID (e.g., "addPet")
- `<apiName>`: The parsed API name from config (e.g., "petstore")

### Class Structure Rules

**Constructor:**
- Must accept a single `httpClient` parameter implementing the `HttpClient` interface.
- Must NOT accept or define `baseUrl`, `authToken`, `apiKey`, or any authentication-related properties.
- Must include this comment above the constructor:
  ```typescript
  // Pass your own http client that implements the HttpClient interface.
  ```
- All base URL and authentication handling is delegated to the `httpClient` implementation.

**Methods:**
- Each endpoint becomes an instance method named after the endpoint's `operationId`.
- All methods must use `this.httpClient` to make requests.
- All methods are instance methods (not static).

**Class Naming:**
- Format: `<ApiName><FirstPathSegment>Client`
- `<ApiName>`: Capitalized API name (e.g., `Petstore`)
- `<FirstPathSegment>`: Capitalized first path segment (e.g., `User` for `/user/login`, `Pet` for `/pet/{id}`)
- Example: `PetstorePetClient` for API `petstore` and path `/pet/{petId}`

**Required HttpClient Interface:**
```typescript
interface HttpClient {
  get(url: string, headers?: Record<string, string>): Promise<any>;
  post(url: string, body?: any, headers?: Record<string, string>): Promise<any>;
  put(url: string, body?: any, headers?: Record<string, string>): Promise<any>;
  delete(url: string, headers?: Record<string, string>): Promise<any>;
}
```

## Method Generation Rules

### Parameter Ordering in Method Signatures

Parameters must appear in this order:
1. **Path parameters** (required, positional)
2. **Query parameters** (optional, single object with all query params as optional properties)
3. **Request body** (required if endpoint has requestBody, named `body`)
4. **Headers** (optional, named `headers`)

Examples:
- GET with path + query: `async getPet(petId: number, query?: { details?: boolean }, headers?: Record<string, string>): Promise<GetPetResponse>`
- POST with body: `async createPet(body: CreatePetRequest, headers?: Record<string, string>): Promise<CreatePetResponse>`
- DELETE with path: `async deletePet(petId: number, headers?: Record<string, string>): Promise<void>`

### Query Parameter Serialization

- **Flat objects only**: Query parameters are always a single flat object (no nested objects).
- **Arrays**: If a query param is an array (e.g., `tags: string[]`), serialize using `URLSearchParams`, which handles array values via comma separation or bracket notation per API convention.
- **Encoding**: Use `URLSearchParams` for automatic URL encoding of special characters.

Example implementation:
```typescript
if (query) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach(v => params.append(key, v));
    } else if (value !== undefined) {
      params.append(key, String(value));
    }
  });
  const queryString = params.toString();
  if (queryString) url += `?${queryString}`;
}
```

### Response Handling

- **Single success response**: Return type is `Promise<ResponseType>`. Use `<operationId>Response` naming for the interface.
- **Multiple success/error responses (different status codes)**: Include all in a union type. Example: `Promise<FindPetByIdResponse | FindPetByIdError>` for 200/404 responses. Each status code gets its own interface derived from the response schema.
- **Void/No response**: If `generate-client-schema` returns `response: null`, generate `Promise<void>` as return type.
- **Response type naming**: Use `<operationId>Response`, `<operationId>Error`, `<operationId>NotFound`, etc. to reflect the complete response schema for each status code, not just extracted data properties.

### URL Construction

- Path parameters are substituted using template literals: `/pet/${petId}`
- Query string is appended only if query parameters exist and are not empty
- Do not include the base URL; the `httpClient` implementation handles it

## Complete Example

### Sample Input: generate-client-schema Output

```json
{
  "operationId": "findPetById",
  "method": "GET",
  "path": "/pet/{petId}",
  "parameters": [
    { "name": "petId", "in": "path", "required": true, "type": "integer" },
    { "name": "details", "in": "query", "required": false, "type": "boolean" }
  ],
  "requestBody": null,
  "responses": {
    "200": { "type": "object", "properties": { "id": { "type": "number" }, "name": { "type": "string" } } },
    "404": { "type": "object", "properties": { "error": { "type": "string" } } }
  }
}
```

### Sample Output: Generated TypeScript Client

```typescript
/**
 * Petstore Client - findPetById
 * Generated from petstore OpenAPI schema by openapi-skills.
 */

interface HttpClient {
  get(url: string, headers?: Record<string, string>): Promise<any>;
  post(url: string, body?: any, headers?: Record<string, string>): Promise<any>;
  put(url: string, body?: any, headers?: Record<string, string>): Promise<any>;
  delete(url: string, headers?: Record<string, string>): Promise<any>;
}

export interface FindPetByIdResponse {
  id: number;
  name: string;
}

export interface FindPetByIdError {
  error: string;
}

export class PetstorePetClient {
  // Pass your own http client that implements the HttpClient interface.
  constructor(private httpClient: HttpClient) {}

  /**
   * Find pet by ID.
   * @param petId - ID of pet to return
   * @param query - Optional query parameters
   * @param headers - Optional HTTP headers
   * @returns Promise resolving to FindPetByIdResponse or FindPetByIdError
   */
  async findPetById(
    petId: number,
    query?: { details?: boolean },
    headers?: Record<string, string>
  ): Promise<FindPetByIdResponse | FindPetByIdError> {
    let url = `/pet/${petId}`;
    
    if (query) {
      const params = new URLSearchParams();
      if (query.details !== undefined) {
        params.append('details', String(query.details));
      }
      const queryString = params.toString();
      if (queryString) url += `?${queryString}`;
    }

    return this.httpClient.get(url, headers);
  }
}
```

### Key Implementation Points

1. **Type definitions** for request/response are placed above the class
2. **Constructor** accepts only `httpClient`; no auth or baseUrl handling
3. **Method signature** follows parameter order: path → query → headers
4. **URL construction** is relative (no base URL; httpClient adds it)
5. **Query serialization** uses URLSearchParams for proper encoding
6. **Return type** is a union of all possible response types (`FindPetByIdResponse | FindPetByIdError`)
7. **Response type naming** reflects the complete response schema (not extracted properties). Use `<operationId>Response` and `<operationId>Error` format
8. **JSDoc** documents parameters and return type
