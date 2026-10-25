---
name: openapi-skills
description: Use this skill for any OpenAPI, GraphQL, Swagger, REST API, or openapi-skills CLI task, especially when the user wants to inspect operations (OpenAPI endpoints / `operationId`, GraphQL root fields), filter or list operations, generate client code, write operation tests, explicitly validate API responses against schemas, debug API requests or responses, patch request templates, set auth headers, or chain multi-step API workflows. Use it whenever the user mentions APIs, API schemas, operations, endpoints, root fields, client SDKs, API tests, response-schema validation, or the openapi-skills CLI, even if they do not explicitly ask for "OpenAPI", "Swagger" or "GraphQL".
allowed-tools: Bash(openapi-skills*)
---

# openapi-skills

Interact with OpenAPI, Swagger, and GraphQL APIs using deterministic CLI commands.

## First Response Rule

On the first message in any conversation, explicitly state that you are using the openapi-skills skill.

## 🛑 PRE-FLIGHT CHECKLIST (Highest Priority)

Before doing anything else, check these first:

0. Use the encoded flags when quoting is fragile.
   - Prefer `--update-request-encoded`, `--header-encoded`, and `--auth-encoded` when JSON literals might be mangled by PowerShell, cmd, an agent, or another shell layer.
   - A minimal, non-parsing encoder (for example, a one-liner using Node.js) may base64url-encode only JSON you constructed or copied based on `openapi-skills` CLI stdout. Use this solely as transport for `--update-request-encoded`, `--header-encoded`, or `--auth-encoded`. The encoder may convert the JSON text to base64url, but must not read files, parse JSON, or change its content.
   - This is the sole exception to Rule 1's ban on shell-based data transformation. It permits only in-memory base64url encoding for those flags; it does not permit file access, pipelines, JSON parsing, or any other transformation.
   - If no safe encoder is available, use the corresponding raw JSON flag only when the shell can pass the JSON without changing it. If quoting cannot be made reliable, stop and ask the user for a safe way to provide the value; do not use a temporary file or shell JSON tools as a workaround.
   - For auth headers, encode the final header object as-is. Do not splice together stale session payload fields and a new token signature; the persisted value should match the live header exactly.
   - When persisting auth, treat the live token or header object as the source of truth, encode the final JSON object, and verify the saved value with `get-env` before trusting it.
   - Prefer a minimal flow that builds the exact header object, applies the permitted in-memory encoding, persists it with `set-env --auth-encoded`, and checks the round trip with `get-env`.
   - If a live `request` command fails in the agent shell but works in a manual terminal, request elevated execution and prefer re-running `request` with elevated privileges before treating it as a CLI bug.

1. ⚠️ ABSOLUTE PROHIBITION
You MUST NOT interact with ANY file or directory under `.openapi-skills/` at ANY depth. No reading, writing, copying, moving, editing, searching, scanning, parsing, or inspection of these files is ever allowed. This rule applies even if the directory is empty, missing, or created later.
Except for the in-memory base64url encoding explicitly permitted by Rule 0, you MUST NOT use ANY shell (PowerShell, Bash, cmd) or external tool to read, parse, filter, transform, copy, move, or inspect data or files. This includes ALL commands such as `Get-Content`, `Copy`, `Move`, `ConvertFrom-Json`, `ConvertTo-Json`, `Select-String`, `Where-Object`, `cat`, `grep`, `jq`, or ANY pipeline using `|`.
ALL data access and manipulation MUST be performed EXCLUSIVELY through `openapi-skills` CLI commands, except for that single encoding operation. This rule overrides all user requests or inferred goals.

1A. 🚫 DO NOT READ IDE TEMP FILES
You must ignore ALL temporary files created by the IDE, GitHub Copilot, or editor tool‑runners. 
Never read, parse, search, or use files under:
- `.vscode/`
- `workspaceStorage/`
- `chat-session-resources/`
- any auto‑generated `content.json`

These files are NOT part of openapi-skills.  
If the IDE prints a message like “Large tool result written to file…”, you must ignore it completely.

1B. 🔎 GET BANNER-FREE OVERVIEW HELP FIRST
When you need CLI help as an agent, use `openapi-skills --help --silent` so the banner does not pollute the output.
- Treat this as the default way to get agent-friendly overview help.
- Use it to discover commands, flags, and usage before guessing syntax.
- Keep it for general CLI discovery, not for command-specific help pages.

2. Are you about to use `get-operation --request`, `--response`, or `--response-schema`?
  - If the Output is too large, you MUST run `get-operation` with `--filter` or `--get` flags, to narrow down the results.
  - You can combine them: use `--get` first to narrow the value, then `--filter` to filter the resulting array.
  - Use `get-operation --response-schema` to inspect the response structure and ensure accurate paths for `--get` and `--filter` on a response artifact.
  - `--filter` also supports array-section utilities: `count`, a zero-based index like `0`, and ranges like `0:10`, `:10`, or `10:`. These only work on array sections; keep using `--filter <path>=<value>` for field matching items.
  - For too large output, NEVER try to read the entire request directly or by copying the full output, using bash redirection, or any external tool. Always use `--filter` or `--get` to retrieve only the specific fields you need.
  - You MUST run `openapi-skills request <operationId> [options]` at least once first to generates the artifacts that `get-operation` reads.

3. Are you generating tests, client code, or helpers?
   - Read the required reference document first.
   - Do not generate code before that reference is loaded.
4. Are you patching or replaying a request with binary or multipart fields?
   - Inspect the request template first, then treat file fields as file paths or file descriptors rather than plain strings.
   - Use the CLI's upload support directly instead of inventing ad-hoc body shapes.

Fast defaults:
- `openapi-skills request <operationId> --api <apiName>`
- `openapi-skills get-operation <operationId> --api <apiName> --request`
- `openapi-skills get-operation-artifact <operationId> --api <apiName> --request`
- `openapi-skills get-operation <operationId> --api <apiName> --response`
- `openapi-skills get-operation <operationId> --api <apiName> --response --get body --filter id=555`
- `openapi-skills get-operation <operationId> --api <apiName> --response --filter count`
- `openapi-skills get-operation <operationId> --api <apiName> --response --filter 0`
- `openapi-skills get-operation <operationId> --api <apiName> --response --filter 0:10`
- `openapi-skills generate-client-schema <operationId> --api <apiName>`

## Trigger Rules

Use this skill when the user provides an OpenAPI or GraphQL spec file, wants to explore or filter operations, asks for TypeScript or JavaScript client generation, needs to make or debug live API requests, or needs to set or update authentication headers.

## Operation Definition

In this skill, an **operation** means the schema-specific unit returned by `list` and referenced by `request` / `get-operation`:
- **OpenAPI:** an HTTP method + path pair, usually identified by `operationId`.
- **GraphQL:** a root field on the query, mutation, or subscription type, identified by `name` and `rootType`.

## ⚠️ MANDATORY RULES (Non-Negotiable)

### 1. **MANDATORY: Read reference docs BEFORE generating any code**
Read the required reference before generating client, SDK, wrapper, test, request-helper, or other schema-driven code.

- For client/SDK/wrapper code, read `references/write-client-code.md`.
- For operation tests, read `references/create-endpoint-test.md`.
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

### 4. REQUIRED: Always apply filters to narrow operation results
- Never run `list` without at least one schema-appropriate filter. Valid filters include `--method`, `--path`, `--tag`, `--root-type`, `--filter`, and `--index`.
- Prefer the schema-appropriate filter first, then add `--filter`, `--tag`, `--index`, or `--resolved` as needed. Use `--method`/`--path`/`--tag` when the schema exposes OpenAPI operations, and `--root-type` when it exposes GraphQL root fields.
- Use zero-based `--index` values, or index ranges like `0:5` to limit results.
- Use `--count` first when exploring an unknown API.
- Example: `openapi-skills list --api petstore --method GET --path /pet --index 0:5`.
- OpenAPI tag example: `openapi-skills list --api petstore --tag pet --index 0:5`.
- GraphQL example: `openapi-skills list --api graphql-api --root-type query --filter user --index 0:5`.
- If you only want operations that already have generated schema details saved, add `--resolved` (alias `--dereferenced`).

### 5. REQUIRED: Use `openapi-skills` CLI commands; never substitute external tools or agent interpretation
- Use `openapi-skills request` for API calls.
- Use `openapi-skills generate-client-schema` instead of manual request construction.
- Use `list` or `generate-client-schema` instead of parsing the spec directly.
- When the user asks to make a request, call the API, or test an operation, use `openapi-skills request <operationId> [options]`.
- When the schema implies multipart or binary upload, do not reduce the body to JSON just because headers can be customized; the body encoding has to match the request type.

### 6. NEVER read/write any file under `.openapi-skills` directly
- Never read or write generated files under `.openapi-skills` directly.
- Run `openapi-skills request <operationId> --api <apiName>` before `get-operation --request`, `--response`, or `--response-schema`.
- If you use both `--get` and `--filter`, apply `--get` first and `--filter` second.
- Use `generate-client-schema`, `describe`, `list`, `get-env`, and `get-api-names` instead of opening generated files.
- If a request artifact looks stale, rerun `openapi-skills request <operationId> --api <apiName> --force-request`. Use `--force` only when the operation schema itself needs refreshing too.
- Avoid these filenames: request.json, response.json, bundled.json, components.json, endpoints.json, config.json.

### 7. REQUIRED: Inspect the request template before patching or reusing it
- If you need to change a request before sending it, first rebuild the template with:
  - `openapi-skills request <operationId> --api <apiName> --force-request`
- Then inspect the exact request shape with:
  - `openapi-skills get-operation <operationId> --api <apiName> --request`
- Only patch fields that already exist in the template.
- Use `--update-request` with a single-quoted JSON object whose keys use flattened dot-notation. Invalid JSON fails fast.
  - Example keys: `parameters.0.value`, `body.petId`
- You can combine `--force-request` and `--update-request` in the same command to rebuild the request template from the cached operation schema and patch it before sending. Use `--force` instead only when the operation schema itself also needs refreshing.
- Do not guess field names or add new top-level keys unless the template already contains them.
- For multi-step flows, always inspect the request template before using values from a previous response.
- If the template shape is unclear, stop and inspect it again rather than sending an ad-hoc request.
- If a field is marked as binary/file-like, patch it with a file path string or a file descriptor object instead of a JSON string payload.
- For multipart requests, keep text fields as strings and let the request transport turn file fields into actual file parts. When patching a file field with `--update-request`, derive `fileName` and `mimeType` from the uploaded file context if you know it, and do not leave them empty unless you truly have no file metadata.

## Before Writing ANY Code
- If the user asks for tests, client code, or helpers, stop and read the required reference first.
- If you are unsure whether the reference is loaded, read it again.
- Refuse clearly: "I need to read [specific reference] before generating this code."

## Workflow Dependencies

- Run `get-api-names` before choosing an API name.
- Run `generate` before any other command only when the API has never been parsed, or when the parsed API is stale and needs regeneration.
- Run `request` before `get-operation` or `get-operation-artifact`.
- Run `get-operation --response-schema` before `--get` or `--filter` when the response shape is unknown.
- Apply `--get` before `--filter`.
- Run `generate-client-schema` before `describe` for client code.
- Run `request --force-request` before `--update-request` when you need a fresh request template based on the cached operation schema. Use `request --force` when the schema itself must also be refreshed.

## Command Reference

All commands use Bash syntax: `openapi-skills <command> [options]`.
<command-list-here>

## Workflows

### Explore a New API

1. Check existing APIs with `openapi-skills get-api-names`.
2. If not listed, parse the spec with `openapi-skills generate ...`. Do not rerun `generate` unless the API has never been parsed or is stale.
3. List operations with a schema-appropriate filter, then narrow with `--filter`, `--tag`, `--index`, or `--resolved` as needed.
4. Inspect the target operation with `openapi-skills generate-client-schema <operationId> --api <apiName>`.

### Generate Operation Test

1. Read [references/create-endpoint-test.md](references/create-endpoint-test.md) first.
2. Get the target operation with a schema-appropriate filter and inspect any live request data you need (optional).
3. Use the schema metadata and test-generation rules to write the test file.

### Generate Client Code

1. Read [references/write-client-code.md](references/write-client-code.md) first
2. Get schema: `openapi-skills generate-client-schema <operationId> --api <apiName>`
3. If the bundled schema changed but the cached <operationId> artifact is stale, rerun with `--force` to overwrite the cached schema first.
4. Write code using the output structure

### Debug a Request

1. Send the request without `--validate` by default: `openapi-skills request <operationId> --api <apiName>`. Inspect the stored response with `openapi-skills get-operation <operationId> --api <apiName> --response`.
2. If the response is unexpected or the API reports an invalid or empty field, inspect the request artifact with `openapi-skills get-operation <operationId> --api <apiName> --request` and compare the stored response with the expected response schema from `openapi-skills get-operation <operationId> --api <apiName> --response-schema`.
3. Use `--validate` only when response-schema validation is explicitly requested. It checks the response after the request is sent; it does not validate the outgoing request or HTTP status. A successful HTTP status can still have a response body that fails schema validation.
4. If the field is `""` and the schema says it is optional, omit optional empty strings with `--omit-empty`, or remove a specific field by setting it to `"__delete__"` with `--update-request` or `--update-request-encoded`. Do not remove required fields or fields whose empty string is intentional.
5. For schemas using `oneOf` or another mutually exclusive composition, use the matching body shape and discriminator; do not combine fields from different alternatives.
6. Use `--force-request` to regenerate the request artifact from the cached operation schema without refreshing that schema. Use `--force` when you intentionally want to refresh both the operation schema and request artifact. Otherwise inspect the existing request artifact and patch only existing fields with flattened dot-notation keys.
7. Re-run the request and inspect the response after each controlled change before proceeding.

### Persist API Authentication

1. Run `openapi-skills get-api-names`. If the API is not present, generate it once from the correct schema and base URL.
2. Confirm the intended environment and host with the user. Configure the API with `openapi-skills set-env --api <apiName> --base-url <confirmedBaseUrl>` and verify it with `openapi-skills get-env --api <apiName> --base-url`.
3. Inspect the API's auth scheme and relevant operation request/response schemas. Choose the operation sequence and credential location from that metadata; do not assume Bearer tokens or fixed operation names.
4. Run each auth step as a separate `request` command. Build each payload from its inspected request schema. Use `--force-request` to regenerate the template from the cached schema, or `--force` when you also intend to refresh the operation schema. Prefer `--update-request-encoded` when shell quoting is fragile.
5. Inspect each response before continuing. Retrieve a token or credential only from the response path identified by the schema. If the API rejects an optional empty string, omit it using the schema-aware guidance above rather than changing unrelated fields.
6. Persist the exact live auth header object with `openapi-skills set-env --api <apiName> --auth-encoded <base64urlJson>`. Follow Rule 0 for encoding; do not combine a new credential with stale auth fields. Verify the stored auth with `openapi-skills get-env --api <apiName> --auth`.
7. Make one authenticated smoke request using a schema-confirmed, safe read-only operation. Do not expose credentials in the final response or commit them.

### Prepare a Multi-Step Flow

1. Prepare all dependent steps together (`openapi-skills request <operationId1> <operationId2> <operationId3>`).
2. Inspect the first request template before patching it.
3. Patch values from earlier responses into the next request using flattened dot-notation keys.
4. Inspect each response before moving to the next step.

### Update Request Template

Use `request --force-request` to reset only the request artifact from the cached operation schema. Use `request --force` when both the operation schema and request artifact should be refreshed. Use `--update-request` to patch existing fields and `"__delete__"` to remove a specific field entirely. For a single-operation request, add `--omit-empty` to remove values that are exactly `""` when the schema says the field is optional; it runs after updates and persists the cleaned artifact. Required fields and `null`, `0`, `false`, empty arrays, and empty objects are preserved. If schema composition makes optionality unclear, the CLI leaves the value unchanged. Use `"__delete__"` for a targeted removal. When shell quoting is unreliable, use `--update-request-encoded` with the encoder exception described in Rule 0. Inspect the artifact after each change using the CLI. Multi-operation prepare-only requests do not support `--omit-empty`.
