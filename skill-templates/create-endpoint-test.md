# API Endpoint Test Generation Skill

## Purpose
Generate live integration tests for OpenAPI endpoints that exercise and validate the generated client code against a real API.

## Core Principle
**All generated tests MUST call the endpoint exclusively through the generated client class. NO direct HTTP calls (fetch, axios, supertest, etc.). NO mocks or test doubles.**

This ensures:
- Client code is exercised in realistic scenarios
- Tests validate actual API behavior, not mocked behavior
- Tests are maintainable and match client structure

## References (Required Dependencies)
- `/references/write-client-code.md` — Instructions and examples for generating the required client code class
- `/references/http-client.md` — for FetchClient interface specification

---

## File Header Requirement

Every generated test file must start with:
```typescript
// Generated from <apiName> OpenAPI schema by openapi-skills.
```

---

## Agent Workflow (Decision Tree)

**FOLLOW THIS SEQUENCE IN ORDER:**

### Step 1: Gather Prerequisites
1. **Ask for testing framework** (if not specified):
   - Options: Jest, Vitest, Mocha, Node test runner, Playwright
   - Required before proceeding
2. **Check for client code**:
   - It is mandatory to verify whether the generated client file exists in the workspace
   - If the client code file is missing or incomplete, it is mandatory to generate the client code by following `/references/write-client-code.md` before creating any test
   - Do NOT proceed without client code
3. **Verify API is parsed** (`openapi-skills get-api-names`):
   - Extract `apiName` from output
   - If not found, offer to parse it

### Step 2: Retrieve Endpoint Metadata
1. Run: `openapi-skills list --api <apiName> --method <METHOD> --path <prefix>`
2. Extract: `operationId`, `method`, `path`, response codes
3. Note: If endpoint returns multiple response codes (e.g., 200, 404), plan error tests for each

### Step 3: (Optional) Enrich with Live Data
1. Run: `openapi-skills request <operationId> --api <apiName>` (optional)
   - Produces realistic `request.json` and `response.json`
   - Use if request body is complex or response structure unclear
   - NOT required; can generate tests without this

### Step 4: Generate Test File
1. Ensure `/tests` directory exists (create if needed)
2. Generate tests using rules in next sections
3. Filename: `<operationId>.test.ts`

---

## Setup: FetchClient Helper (User Responsibility)

**One-time setup per project:**
1. Copy the `FetchClient` interface from `/references/http-client.md`
2. Save as a separate file `tests/fetch-client.ts` in your project root
3. Agent assumes this file exists when generating tests

**Config File Reference:**
- Location: `.openapi-skills/config.json` (relative to project root)
- Contains API base URL at: `apis.<apiName>.baseUrl`
- Example:
  ```json
  {
    "apis": {
      "petstore": {
        "baseUrl": "https://api.petstore.com",
        "auth": { "Authorization": "Bearer token..." }
      }
    }
  }
  ```

---

## Test Types (Definitions & Requirements)

### 1. Success Test (Happy Path)
**Definition:** Endpoint is called with valid input; API returns a successful response.

**Generates when:** Always (every endpoint has at least one success scenario)

**What to assert:**
- Response structure matches client return type (check keys/types exist)
- Response status is 2xx
- Key fields have expected values (use client types or OpenAPI schema constraints)

**Example triggers:**
- GET endpoint with path `{id}` → provide valid ID, expect pet details
- POST endpoint → provide valid request body, expect 201 + resource ID

**Minimum assertions:**
```typescript
const result = await petClient.getPetById(1);
expect(result).toBeDefined();
expect(result.id).toBe(1); // or typeof check if value varies
expect(result.name).toBeDefined();
```

### 2. Error Test (Failure Scenarios)
**Definition:** Endpoint is called with invalid input or encounters an error; API returns an error response.

**Generates when:** Endpoint defines non-2xx responses (400, 404, 500, etc.)

**How many:** One test per distinct error response type (one 404 test, one 400 test, etc.)

**What to assert:**
- Response structure matches error type from client (e.g., `FindPetError`)
- Response status code matches expected error (404, 400, etc.)
- Error message/details are present

**Example triggers:**
- GET `/pet/{id}` with invalid ID → expect 404 error response
- POST with malformed body → expect 400 error response
- API rate limit exceeded → expect 429 error response

**Minimum assertions:**
```typescript
const result = await petClient.getPetById(999); // invalid ID
expect(result.error).toBeDefined();
expect(result.status).toBe(404);
```

### 3. Validation Test (Input Constraints)
**Definition:** Endpoint requires specific input validation per OpenAPI schema (e.g., required fields, min/max values, enum constraints).

**Generates when:** OpenAPI schema includes validation rules (required properties, minLength, minimum value, enum, pattern, etc.)

**What to assert:**
- Omitting required field → API returns 400 error
- Providing value outside min/max range → API returns 400 error
- Providing invalid enum value → API returns 400 error

**Example triggers:**
- POST body missing required `name` field → expect 400
- Query param `age` with value `-5` (minimum is 0) → expect 400
- Path param with non-numeric value when integer required → expect 400

**Minimum assertions:**
```typescript
// Test: missing required field
const result = await petClient.createPet({}); // missing name
expect(result.error).toBeDefined();
expect(result.error).toContain('required'); // or similar
```

---

## Test Generation Rules

### File Structure
- **Location:** `/tests` directory
- **Filename:** `<operationId>.test.ts`
- **First line:** `// Generated from <apiName> OpenAPI schema by openapi-skills.`

### Client Usage Requirement
- All tests MUST invoke the client's method for the endpoint under test
- Import the client class: `import { PetstorePetClient } from '../client/PetstorePetClient'`
- Instantiate with `FetchClient`: `const client = new PetstorePetClient(httpClient)`
- Call method: `const result = await client.findPetById(1)`
- No direct HTTP calls, mocks, or test doubles

### FetchClient Setup in Tests
```typescript
import fs from 'fs-extra';
import path from 'path';
import { FetchClient } from './fetch-client';
import { PetstorePetClient } from '../client/PetstorePetClient';

const config = await fs.readJson(path.resolve('.openapi-skills/config.json'));
const apiBaseUrl = config.apis.petstore.baseUrl;

const httpClient = new FetchClient(apiBaseUrl);
const petstorePetClient = new PetstorePetClient(httpClient);
```

### Test Count per Endpoint
- **Success test:** Always (1)
- **Error tests:** One per non-2xx response code defined in endpoint (0 to N)
- **Validation tests:** One per input validation rule if applicable (0 to N)
- **Minimum:** 1 (success); 2-3 typical

### Assertions Strategy
1. **Structure assertions:** Verify response keys/properties exist
2. **Type assertions:** Verify values match expected types (number, string, etc.)
3. **Value assertions:** Use realistic values from OpenAPI constraints or live request data
4. **Status assertions:** Explicitly check response status code (2xx for success, specific codes for errors)

Example:
```typescript
const result = await petClient.getPetById(1);
expect(result).toBeDefined();
expect(typeof result.id).toBe('number');
expect(result.id).toBe(1);
expect(result.name).toBeDefined();
```

### Error Handling
- Derive error response types from client return union (e.g., `FindPetByIdError`)
- Assert error structure matches client interface
- Include status code and error message in assertions
- Do NOT use try/catch for error tests; assert on response object

Example:
```typescript
const result = await petClient.getPetById(999);
expect(result.error).toBeDefined();
expect(result.status).toBe(404);
expect(result.error.message).toContain('not found');
```

### Client Variable Naming
- Use descriptive, endpoint-specific names
- Format: `<ApiName><Endpoint>Client`
- Examples: `petstorePetClient`, `githubRepoClient`, `stripePaymentClient`
- NOT: `client`, `c`, `httpClient`, `apiClient`

---

## Framework Support

### Supported Frameworks
- **Jest** — use `test()`, `expect()`
- **Vitest** — use `test()`, `expect()`
- **Mocha** — use `it()`, `expect()` with assertion library
- **Node test runner** — use `test()`, `assert()`
- **Playwright** — use `test()`, `expect()` from `@playwright/test`

### Framework Agnostic Pattern

All frameworks must follow this structure:

```typescript
import fs from 'fs-extra';
import path from 'path';
import { FetchClient } from './fetch-client';
import { PetstorePetClient } from '../client/PetstorePetClient';

const config = await fs.readJson(path.resolve('.openapi-skills/config.json'));
const apiBaseUrl = config.apis.petstore.baseUrl;
const httpClient = new FetchClient(apiBaseUrl);
const petstorePetClient = new PetstorePetClient(httpClient);

test('getPetById returns pet', async () => {
  const result = await petstorePetClient.getPetById(1);
  expect(result.id).toBe(1);
});

test('getPetById returns 404 for invalid id', async () => {
  const result = await petstorePetClient.getPetById(999);
  expect(result.error).toBeDefined();
});
```

### Playwright API Testing
When user selects Playwright:

```typescript
import { test, expect } from '@playwright/test';
import fs from 'fs-extra';
import path from 'path';
import { FetchClient } from './fetch-client';
import { PetstorePetClient } from '../client/PetstorePetClient';

test('getPetById returns pet', async ({ request }) => {
  const config = await fs.readJson(path.resolve('.openapi-skills/config.json'));
  const apiBaseUrl = config.apis.petstore.baseUrl;
  // Passing Playwright's request:APIRequestContext enables FetchClient.fetchWithContext()
  const httpClient = new FetchClient(apiBaseUrl, request);
  const petstorePetClient = new PetstorePetClient(httpClient);
  const result = await petstorePetClient.getPetById(1);
  expect(result.id).toBe(1);
});
```

**Important:** Playwright tests are API-only (not browser/UI tests). Use same client-driven pattern as other frameworks.

---

## Error Handling & Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| **FetchClient import fails** | Verify `tests/fetch-client.ts` exists and copied from `/references/http-client.md` |
| **Config file not found** | Verify `.openapi-skills/config.json` exists in project root |
| **API base URL wrong** | Check `apis.<apiName>.baseUrl` in config.json matches live API |
| **Client class import fails** | Verify client code generated first using `/references/write-client-code.md` |
| **Tests fail at runtime** | Ensure live API is accessible; tests perform real HTTP requests |
| **Response doesn't match type** | Verify OpenAPI schema is accurate; report schema issues to API maintainer |

---

## Examples

### Example 1: Jest Test (GET endpoint)
```typescript
// Generated from petstore OpenAPI schema by openapi-skills.
import fs from 'fs-extra';
import path from 'path';
import { FetchClient } from './fetch-client';
import { PetstorePetClient } from '../client/PetstorePetClient';

const config = await fs.readJson(path.resolve('.openapi-skills/config.json'));
const apiBaseUrl = config.apis.petstore.baseUrl;

describe('PetstorePetClient', () => {
  let httpClient: FetchClient;
  let petstorePetClient: PetstorePetClient;

  beforeEach(() => {
    httpClient = new FetchClient(apiBaseUrl);
    petstorePetClient = new PetstorePetClient(httpClient);
  });

  test('getPetById returns pet for valid id', async () => {
    const result = await petstorePetClient.getPetById(1);
    expect(result).toBeDefined();
    expect(result.id).toBe(1);
    expect(typeof result.name).toBe('string');
  });

  test('getPetById returns 404 for invalid id', async () => {
    const result = await petstorePetClient.getPetById(999);
    expect(result.error).toBeDefined();
    expect(result.status).toBe(404);
  });
});
```

### Example 2: Vitest Test (POST endpoint)
```typescript
// Generated from petstore OpenAPI schema by openapi-skills.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { FetchClient } from './fetch-client';
import { PetstorePetClient } from '../client/PetstorePetClient';

const config = await fs.readJson(path.resolve('.openapi-skills/config.json'));
const apiBaseUrl = config.apis.petstore.baseUrl;

describe('PetstorePetClient', () => {
  let httpClient: FetchClient;
  let petstorePetClient: PetstorePetClient;

  beforeEach(() => {
    httpClient = new FetchClient(apiBaseUrl);
    petstorePetClient = new PetstorePetClient(httpClient);
  });

  it('createPet creates and returns pet', async () => {
    const body = { name: 'Fluffy', status: 'available' };
    const result = await petstorePetClient.createPet(body);
    expect(result.id).toBeDefined();
    expect(result.name).toBe('Fluffy');
  });

  it('createPet returns 400 for missing required name', async () => {
    const body = { status: 'available' };
    const result = await petstorePetClient.createPet(body);
    expect(result.error).toBeDefined();
    expect(result.status).toBe(400);
  });
});
```

### Example 3: Playwright Test (API testing)
```typescript
// Generated from petstore OpenAPI schema by openapi-skills.
import { test, expect } from '@playwright/test';
import fs from 'fs-extra';
import path from 'path';
import { FetchClient } from './fetch-client';
import { PetstorePetClient } from '../client/PetstorePetClient';

const config = await fs.readJson(path.resolve('.openapi-skills/config.json'));
const apiBaseUrl = config.apis.petstore.baseUrl;

test.describe('PetstorePetClient', () => {
  let httpClient: FetchClient;
  let petstorePetClient: PetstorePetClient;

  test.beforeEach(() => {
    httpClient = new FetchClient(apiBaseUrl);
    petstorePetClient = new PetstorePetClient(httpClient);
  });

  test('getPetById returns pet', async () => {
    const result = await petstorePetClient.getPetById(1);
    expect(result.id).toBe(1);
    expect(result.name).toBeDefined();
  });

  test('getPetById returns 404 for invalid id', async () => {
    const result = await petstorePetClient.getPetById(999);
    expect(result.error).toBeDefined();
  });
});
```
