---
name: openapi-skills
description: Provides CLI-driven tools for working with OpenAPI/Swagger specs. Use this skill when working with OpenAPI/Swagger specs, generating client code, validating requests, or debugging API interactions.
allowed-tools: Bash(openapi-skills*)
---

# openapi-skills

Interact with OpenAPI/Swagger-described APIs using deterministic CLI commands.

## 🛑 PRE-FLIGHT CHECKLIST (Highest Priority)

Before doing anything else, check these first:

1. Is this a file read or file access?
   - Never read or edit anything under `.openapi-skills/` directly.
   - Use `openapi-skills` CLI commands instead.

2. Are you about to use `get-operation --request`, `--response`, or `--response-schema`?
   - You MUST run `openapi-skills request <operationId> --api <apiName>` at least once first.
   - That command generates the artifacts that `get-operation` reads.

3. Are you generating tests, client code, or helpers?
   - Read the required reference document first.
   - Do not generate code before that reference is loaded.

Fast defaults:
- `openapi-skills request <operationId> --api <apiName>`
- `openapi-skills get-operation <operationId> --api <apiName> --request`
- `openapi-skills get-operation <operationId> --api <apiName> --response`
- `openapi-skills generate-client-schema <operationId> --api <apiName>`

## Trigger Rules

Use this skill when the user provides an OpenAPI or Swagger spec file, wants to explore or filter endpoints, asks for TypeScript or JavaScript client generation, needs to make or debug live API requests, or needs to set or update authentication headers.

## ⚠️ MANDATORY RULES (Non-Negotiable)

### 1. **MANDATORY: Read reference docs BEFORE generating any code**
Read the required reference before generating client, SDK, wrapper, test, request-helper, or other schema-driven code.

- For client/SDK/wrapper code, read `references/write-client-code.md`.
- For endpoint tests, read `references/create-endpoint-test.md`.
- If the request includes phrases like "create test", "generate test", "write test", "build client", "generate client", or "write wrapper", stop and read the matching reference first.
- If the reference is not loaded, refuse with: “I need to read the required reference document before generating code.”

### 2. DO NOT run `generate` for an already-parsed API
- Run `openapi-skills get-api-names` first.
- Run `generate` only if the API is missing, the schema changed, or the base URL changed intentionally.

### 3. ALWAYS use `generate-client-schema` for client code
- Use `generate-client-schema` for client code.
- Use `describe` only when you need the full raw schema and `generate-client-schema` is not enough.
- If the API schema changed, rerun with `--force` to refresh the cached schema output.
- When `response: null`, generate `Promise<void>`.

### 4. REQUIRED: Always apply filters to narrow endpoint results
- Never run `list` without a filter such as `--method`, `--path`, `--filter`, `--index`, or `--resolved`.
- Prefer `--method <METHOD>` first, then add `--path <prefix>`, `--filter <keyword>`, or `--index <range>` as needed.
- Use zero-based `--index` values, or index ranges like `0:5` to limit results.
- Use `--count` first when exploring an unknown API.
- Example: `openapi-skills list --api petstore --method GET --path /pet --index 0:5`.
- If you only want endpoints that already have generated schema details saved, add `--resolved` (alias `--dereferenced`).

### 5. REQUIRED: Use `openapi-skills` CLI commands; never substitute external tools or agent interpretation
- Use `openapi-skills request` for API calls.
- Use `openapi-skills generate-client-schema` instead of manual request construction.
- Use `list` or `generate-client-schema` instead of parsing the spec directly.
- When the user asks to make a request, call the API, or test an endpoint, use `openapi-skills request` with `--validate`.

### 6. NEVER read/write any file under `.openapi-skills` directly
- Never read or write generated files under `.openapi-skills` directly.
- Run `openapi-skills request <operationId> --api <apiName>` before `get-operation --request`, `--response`, or `--response-schema`.
- Use `generate-client-schema`, `describe`, `list`, `get-env`, and `get-api-names` instead of opening generated files.
- If artifacts look stale, rerun `openapi-skills request <operationId> --api <apiName> --force`.
- Avoid these filenames: request.json, response.json, bundled.json, components.json, endpoints.json, config.json.

### 7. REQUIRED: Inspect the request template before patching or reusing it
- If you need to change a request before sending it, first rebuild the template with:
  - `openapi-skills request <operationId> --api <apiName> --force`
- Then inspect the exact request shape with:
  - `openapi-skills get-operation <operationId> --api <apiName> --request`
- Only patch fields that already exist in the template.
- Use `--update-request` with a single-quoted JSON object whose keys use flattened dot-notation. Invalid JSON fails fast.
  - Example keys: `parameters.0.value`, `body.petId`
- Do not guess field names or add new top-level keys unless the template already contains them.
- For multi-step flows, always inspect the request template before using values from a previous response.
- If the template shape is unclear, stop and inspect it again rather than sending an ad-hoc request.

## Before Writing ANY Code
- If the user asks for tests, client code, or helpers, stop and read the required reference first.
- If you are unsure whether the reference is loaded, read it again.
- Refuse clearly: "I need to read [specific reference] before generating this code."

## Decision Matrix: Which Command To Use

| User Request | Do this |
|---|---|
| "Explore endpoints" | Use `list` with `--method` and `--path` first, then add `--filter`, `--index`, ``--resolved`, or `--count` as needed. |
| "How many endpoints?" | Run `list --api <apiName> --method <METHOD> --count`. |
| "Get the 3rd GET endpoint" | Run `list --api <apiName> --method GET --index 2`. |
| "Generate endpoint tests" | Read `references/create-endpoint-test.md`, then use `generate-client-schema`. |
| "Generate client code" | Read `references/write-client-code.md`, then use `generate-client-schema`. |
| "Show endpoint details" | Use `generate-client-schema` first; use `describe` only if needed. |
| "Make a request" / "Debug API" | Use `request` with `--validate`; patch only with a single-quoted JSON object using flattened dot-notation keys. |
| "Set auth headers" | Use `set-env --api <apiName> --auth <json>`. |
| "Parse a new spec" | Check existing APIs first; run `generate` only if needed. |
| "Inspect a prepared request in multi-step flow" | Use `get-operation --request`. |
| "Patch and execute a step in multi-step flow" | Use `request --force --update-request` with a single-quoted JSON object using flattened dot-notation keys. |

## Initialization Sequence

Follow this sequence:

1. Run `openapi-skills get-api-names`.
2. If the API is missing, run `openapi-skills generate <spec-file-or-url> --base-url <url> --no-progress`.
3. Use the confirmed `--api <apiName>` value for all later commands.

## API Selection Logic

| Scenario | Action |
|---|---|
| User specifies `--api <name>` | Use that value directly. |
| `get-api-names` returns one API | Use that API automatically. |
| `get-api-names` returns zero or multiple APIs | Ask the user which API to use. |

## Command Reference

All commands use Bash syntax: `openapi-skills <command> ...`

<command-list-here>

## Workflows

### Explore a New API

1. Check existing APIs: `openapi-skills get-api-names`
2. If not listed, parse it: `openapi-skills generate ./petstore.yaml --base-url https://api.example.com --no-progress`
3. List endpoints: `openapi-skills list --api petstore --path /pet`
4. If you only want endpoints with ready-to-use schema details, add `--resolved`.
5. Inspect endpoint: `openapi-skills generate-client-schema getPetById --api petstore`

### Generate Client Code

1. Read [references/write-client-code.md](references/write-client-code.md) first
2. Get schema: `openapi-skills generate-client-schema <operationId> --api <apiName>`
3. If the bundled schema changed but the cached `.openapi-skills/<api>/schemas/<operationId>.json` file is stale, rerun with `--force` to overwrite the cached schema first.
4. Write code using the output structure

### Debug a Request

1. Validate: `openapi-skills request <operationId> --api <apiName> --validate`
2. Read validation output; it shows exact mismatches
3. MUST run `openapi-skills request <operationId> --api <apiName> --force` first to create the exact request schema artifact.
4. MUST retrieve the generated request schema artifact (created in step 3) with `openapi-skills get-operation <operationId> --api <apiName> --request`.
5. Change values only. NEVER rename, add, or remove key names in the request schema.
6. Populate the required values and issue a new request.
7. If you need to patch fields after restoring the original schema shape: `openapi-skills request <operationId> --api <apiName> --force --update-request '<json>'` and pass a single-quoted JSON object that uses flattened dot-notation keys. Invalid JSON fails fast.
8. Try again: `openapi-skills request <operationId> --api <apiName> --validate`.

**Never edit response.json directly** — adjust request.json parameters instead.

### Prepare a Multi-Step Flow

1. Prepare all steps at once: `openapi-skills request <operationId1> <operationId2> <operationId3> --api <apiName>`
2. Inspect the first template (prepared in step 1): `openapi-skills get-operation <operationId1> --request`
3. Patch and execute the step: `openapi-skills request <operationId1> --force --update-request '{"field.path":"value"}'` using a single-quoted JSON object with flattened dot-notation keys. Invalid JSON fails fast.
4. Inspect the response (from the request executed in step 3): `openapi-skills get-operation <operationId1> --response`
5. Feed response values into the next step in the chain

### Update Request Template

Use `request --force` to reset `request.json` to schema defaults. 
```bash
openapi-skills request <operationId> --api <apiName> --force
```

Use `request --force --update-request` to patch specific fields after restoring the original schema shape by providing a single-quoted JSON object with flattened dot-notation keys. Example:
```bash
openapi-skills request <operationId> --api <apiName> --force --update-request '{"user.name":"Ada","parameters.0.id":1}'
```

Then inspect `request.json` to confirm changes are correct.

## Troubleshooting

| Problem | Next step |
|---|---|
| "API not found" when running `list` or `request` | Run `openapi-skills generate <spec>` first. |
| `get-api-names` returns 0 APIs | Parse a spec with `generate`. |
| `list` returns empty `[]` | Broaden or change the filters, or use `--count`. |
| Large API takes forever to list | Add `--method`, `--path`, `--filter`, `--index` or `--resolved`. |
| request fails | Adjust values using `request --force --update-request` with a single-quoted JSON object containing flattened dot-notation keys. |
| "required property X missing" | Rebuild the request template with `--force`, then patch it. |
| "Invalid type: expected integer, got string" | Use the correct JSON value type in `--update-request`. |
| "404 Not Found" | Check the base URL and whether the resource exists. |

## Reference Documentation

**For generating TypeScript/JavaScript client code:**
- [references/write-client-code.md](references/write-client-code.md)

**For generating endpoint tests:**
- [references/create-endpoint-test.md](references/create-endpoint-test.md)

---

**Note:** Skill installation is performed by the user, not the agent.
