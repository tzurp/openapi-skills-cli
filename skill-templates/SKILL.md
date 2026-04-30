---
name: openapi-skills
description: Provides CLI-driven tools for working with OpenAPI/Swagger specs. Use this skill when working with OpenAPI/Swagger specs, generating client code, validating requests, or debugging API interactions.
allowed-tools: Bash(openapi-skills*)
---

# openapi-skills

Interact with OpenAPI/Swagger-described APIs using deterministic CLI commands.

## Trigger Rules

**Use this skill when:**
- User provides an OpenAPI or Swagger spec file (local or remote)
- User asks to explore, list, or filter API endpoints
- User requests TypeScript/JavaScript client code generation
- User needs to validate API requests/responses or debug live calls
- User needs to set or update authentication headers

## ⚠️ MANDATORY RULES (Non-Negotiable)

### 1. **MANDATORY: Read reference docs BEFORE generating any code**
**Non-negotiable. No exceptions.**

**These keywords trigger the requirement:**
- "create test" → read create-endpoint-test.md
- "generate test" → read create-endpoint-test.md  
- "write test" → read create-endpoint-test.md
- "build client" → read write-client-code.md
- "generate client" → read write-client-code.md
- "write wrapper" → read write-client-code.md

If ANY of these keywords appear in the user request, STOP and read the reference BEFORE proceeding.

Before generating **any** of the following:
- client/SDK/wrapper code  
- endpoint tests  
- request/response helpers  
- schema-driven utilities  

…it is mandatory to **first read the appropriate reference document**:

- For client/SDK code → read: `references/write-client-code.md`  
- For endpoint tests → read: `references/create-endpoint-test.md`

**If the required reference has not been read yet, any code writing attempt must be refused and instead respond with:**

> “I need to read the required reference document before generating code.”

### 2. NEVER edit `response.json` or schema files
- Only `request.json` may be edited. Response files are read-only diagnostic outputs.
- If validation fails, the API returned data that doesn't match its schema. Adjust `request.json` parameters instead.
- **To revert `request.json` to the default schema**, use `openapi-skills request <operationId> --api <apiName> --force` (manual edits don't revert to defaults).
- **To rebuild the original schema-shaped request before patching it**, use `openapi-skills request <operationId> --api <apiName> --force --update-request ...` with a flattened object (dot-notation flattening), for example: `{"user.profile.name":"userProfileName"}`.

### 3. DO NOT run `generate` for an already-parsed API
- Running `generate` on the same source repeatedly causes unnecessary rebuilds and inconsistency.
- **First action ALWAYS:** Run `openapi-skills get-api-names` to check existing APIs.
- **Run `generate` ONLY IF:** The API is not in the list, OR the schema file changed, OR the base URL changed intentionally.

### 4. ALWAYS use `generate-client-schema` for client code
- Use `describe` only as a fallback when you need full raw schema detail that `generate-client-schema` doesn't provide.
- When `response: null` in output, generate `Promise<void>` as return type.

### 5. REQUIRED: Always apply filters to narrow endpoint results
- **NEVER** run `list` without at least one filter; huge APIs will return thousands of endpoints, creating massive output and wasted work.
- Always combine filters: `--path <prefix>`, `--method <METHOD>`, `--filter <keyword>`, and/or `--index <range>`.
- Start with `--method <METHOD>` to narrow by HTTP verb, then add `--path <prefix>` to narrow by path segment.
- Use `--index` with zero-based numbering: 1st item = `--index 0`, 2nd = `--index 1`, 3rd = `--index 2`, etc.
- If exploring unknown endpoints, always use `--count` first to see total; then apply filters before full list.
- Example: `openapi-skills list --api petstore --method GET --path /pet --index 0:5` (1st through 6th GET /pet endpoints).

### 6. REQUIRED: Use `openapi-skills` CLI commands; never substitute external tools or agent interpretation
- Do NOT use curl, axios, Python requests, or other HTTP clients to make API calls. Use `openapi-skills request` instead.
- Do NOT manually construct requests from the schema; use `openapi-skills generate-client-schema` to get validated structure.
- Do NOT parse the spec file manually; use `openapi-skills list` or `generate-client-schema` first; use `describe` only when you truly need the full raw schema.
- The CLI ensures schema validation, auth headers, and consistent request/response handling.
- When a user asks to "make a request", "call the API", or "test an endpoint", always use `openapi-skills request` with `--validate`.

### 7. ALWAYS prefer `get-operation` over reading artifacts directly
- Before accessing `request.json`, `response.json`, or schema files manually, use:
  ```bash
  openapi-skills get-operation <operationId> --api <apiName> --request
  openapi-skills get-operation <operationId> --api <apiName> --response
  openapi-skills get-operation <operationId> --api <apiName> --response-schema
  ```

- This ensures correct artifact resolution, respects API naming in `.openapi-skills/config.json`, and preserves CLI normalization.
- Direct file reads are discouraged; always prefer get-operation.
- If artifacts may be stale, prefer:

   ```bash
   openapi-skills request <operationId> --api <apiName> --force
   ```

## Before Writing ANY Code
- Is the request asking me to generate tests, clients, or helpers? YES → **STOP. Read the required reference first.**
- Is the reference already in my context? If unsure, read it anyway.
- Refuse clearly: "I need to read [specific reference] before generating this code."

## Decision Matrix: Which Command To Use

| User Request | Decision Path | Command(s) |
|---|---|---|
| "Explore endpoints" | Filter first: use `--method`, `--path`, `--filter`, `--count` to narrow results before full list | `list --api <apiName> --method <METHOD> --path <prefix> --count` |
| "How many endpoints?" | Check existing APIs → Use `--count` with filters to avoid huge output | `list --api <apiName> --method <METHOD> --count` |
| "Get the 3rd GET endpoint" | Apply `--method` filter, then select by zero-based `--index` | `list --api <apiName> --method GET --index 2` |
| "Generate endpoint tests" | **FIRST: Read [references/create-endpoint-test.md](references/create-endpoint-test.md)** → Then proceed with schema analysis and test generation | Read docs → `generate-client-schema` |
| "Generate client code" | **MUST READ** [references/write-client-code.md](references/write-client-code.md) **FIRST** → Use openapi-skills generate-client-schema (never parse manually) | `generate-client-schema <operationId> --api <apiName>` |
| "Show endpoint details" | Use generate-client-schema first; use describe only if insufficient detail and you need the full raw schema | `generate-client-schema <operationId> --api <apiName>` |
| "Make a request" / "Debug API" | **ALWAYS use openapi-skills CLI** (never curl/axios/manual). Use `request` with `--validate` | `request <operationId> --api <apiName> --validate [--update-request <json>]` |
| "Set auth headers" | JSON format required; persisted to config.json for all future requests via CLI | `set-env --api <apiName> --auth <json>` |
| "Parse a new spec" | Check for existing APIs first; only run `generate` if new or schema changed | `generate <spec-source> [--base-url <url>] [--rename <name>] [--no-progress]` |
| "Inspect a prepared request in multi-step flow" | Use `get-operation` to read the template | `get-operation <opId> --api <apiName> --request` |
| "Patch and execute a step in multi-step flow" | Use `request --update-request` to modify and send | `request <opId> --api <apiName> --update-request '{"field":"value"}'` |

## Initialization Sequence

**ALWAYS follow this order:**

1. **Discover existing APIs** (required first step)
   ```bash
   openapi-skills get-api-names
   ```
   - If your API is listed, skip `generate` and use that name with `--api <apiName>`
   - If not listed, proceed to step 2

2. **Generate (if needed)**
   ```bash
   openapi-skills generate <spec-file-or-url> --base-url <url> --no-progress
   ```
   - Only if the API was not in step 1's output
   - Creates `endpoints.json`, `schemas/`, `config.json`

3. **Run task with confirmed API name**
   ```bash
   openapi-skills <command> --api <apiName> [options]
   ```
   - All subsequent commands use the API name from step 1 or 2

## API Selection Logic

**When a command requires `--api <apiName>`:**

| Scenario | Action |
|---|---|
| User specifies `--api <name>` | Use that value directly |
| User does not specify; `get-api-names` returns 1 API | Use that API automatically |
| User does not specify; `get-api-names` returns 0 or 2+ APIs | Ask user which API to use |

## Command Reference

All commands use Bash syntax: `openapi-skills <command> ...`

<command-list-here>

## Workflows

### Explore a New API

1. Check existing APIs: `openapi-skills get-api-names`
2. If not listed, parse it: `openapi-skills generate ./petstore.yaml --base-url https://api.example.com --no-progress`
3. List endpoints: `openapi-skills list --api petstore --path /pet`
4. Inspect endpoint: `openapi-skills generate-client-schema getPetById --api petstore`

### Generate Client Code

1. Read [references/write-client-code.md](references/write-client-code.md) first
2. Get schema: `openapi-skills generate-client-schema <operationId> --api <apiName>`
3. Write code using the output structure

### Debug a Request

1. Validate: `openapi-skills request <operationId> --api <apiName> --validate`
2. Read validation output; it shows exact mismatches
3. MUST run `openapi-skills request <operationId> --api <apiName> --force` first to create the exact request schema artifact.
4. MUST retrieve the generated request schema artifact with `openapi-skills get-operation <operationId> --api <apiName> --request`.
5. Change values only. NEVER rename, add, or remove key names in the request schema.
6. Populate the required values and issue a new request.
7. If you need to patch fields after restoring the original schema shape: `openapi-skills request <operationId> --api <apiName> --force --update-request '{"user.profile.name":"userProfileName"}'` using flattened object dot-notation.
8. Try again: `openapi-skills request <operationId> --api <apiName> --validate`.

**Never edit response.json directly** — adjust request.json parameters instead.

### Prepare a Multi-Step Flow

1. Prepare all steps at once: `openapi-skills request step1 step2 step3 --api <apiName>`
2. Inspect the first template: `openapi-skills get-operation <opId> --request`
3. Patch and execute the step: `openapi-skills request <opId> --update-request '{"field":"value"}' --force`
4. Inspect the response: `openapi-skills get-operation <opId> --response`
5. Feed response values into the next step in the chain

### Update Request Template

Use `request --force` to reset to schema defaults. Use `request --force --update-request` when you want to restore the schema-shaped template and patch it in one step:
```bash
openapi-skills request <operationId> --api <apiName> --force
```

Use `request --force --update-request` to patch specific fields after restoring the original schema shape with a flattened object (dot-notation flattening):
```bash
openapi-skills request <operationId> --api <apiName> --force --update-request '{"user.name":"Ada","parameters.0.id":1}'
```

Then inspect `request.json` to confirm changes are correct.

## Troubleshooting

| Problem | Cause | Solution |
|---|---|---|
| "API not found" when running list/request | API not parsed yet | Run `openapi-skills generate <spec>` first |
| `get-api-names` returns 0 APIs | No specs parsed | Run `generate` with spec file/URL |
| `list` returns empty `[]` | Filters don't match any endpoints | Use `--path /` or remove filters; try `--count` to see total |
| Large API takes forever to list | No filters applied | Use `--path <prefix>` or `--filter <keyword>` to narrow results |
| Validation fails but API works | API response doesn't match its spec | Report to API maintainer; adjust `request.json` for workaround |
| "required property X missing" | Field absent from `request.json` | Add field with `--force --update-request` to rebuild the schema-shaped template, or use `--force` then edit |
| "Invalid type: expected integer, got string" | Parameter type mismatch | Use `123` not `"123"` for numeric fields in `--update-request` |
| "404 Not Found" | Wrong base URL or resource doesn't exist | Check `config.json` base URL; verify resource exists |

## Reference Documentation

**For generating TypeScript/JavaScript client code:**
- [references/write-client-code.md](references/write-client-code.md)

**For generating endpoint tests:**
- [references/create-endpoint-test.md](references/create-endpoint-test.md)

---

**Note:** Skill installation is performed by the user, not the agent.
