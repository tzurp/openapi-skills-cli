# openapi-skills
API CLI with SKILLS
<p align="center">
<img src="https://raw.githubusercontent.com/tzurp/images/refs/heads/main/openapi-skills.png">
</p>

Command-line tools for exploring, validating, and generating artifacts from OpenAPI/Swagger and GraphQL specifications.  
Includes a built-in, schema-agnostic skill bundle that helps AI tools operate the CLI and write API tests and client code.

---

## Core Capabilities

- Explore and inspect OpenAPI 2.0/3.x and GraphQL (SDL and code-first/builder) schemas  
- Parse specs into structured artifacts (`endpoints.json`, `schemas/`)  
- List operations, filter by OpenAPI method or GraphQL root type, structured path matching, or keywords  
- Describe operations with full raw schema detail  
- Retrieve stored operation artifacts (`request.json`, `response.json`, `response-schema.json`)  
- Validate live API requests and responses against the OpenAPI contract  
- Generate typed client metadata for TypeScript/JavaScript SDKs  
- Create and update request templates (`request.json`)  
- Manage and persist authentication headers  
- Generate operation tests from scenario descriptions  

---

## About the Skills

`openapi-skills` ships with a built-in skill bundle for AI tools.  
These skills:

- are **generic**  
- are **schema‑agnostic**  
- teach tools **how to use the CLI**, not how to call your API  

Your OpenAPI specification is used to generate **artifacts** (schemas, validators, tests).  
The skills simply describe how to run the tool.

---

> ⚠️ **Important**
> This CLI was designed to be used by AI agents **together with the installed skill** (see: Installing Skills for AI Agents).  
> If the agent is not using the skill, it may attempt to read the **entire schema**, causing extremely high token usage on large APIs.  
> It is the user's responsibility to install the skill and ensure the agent is calling the CLI rather than parsing schemas directly.

---

## 📦 Installation

```bash
npm install -g openapi-skills
```

`openapi-skills` is designed to work inside a project directory. If the folder has not been initialized with `npm init`, it is recommended to add a minimal `package.json` file first, for example:

```json
{}
```

This helps prevent unexpected behavior when the CLI needs to resolve or install project-local dependencies.

### GraphQL builder schemas

GraphQL SDL works without extra setup.

Builder-style GraphQL schemas are detected separately and only load TypeScript when the source looks like a builder file. If TypeScript is already installed in the project, the CLI uses it directly. If it is missing, the CLI asks before installing it locally in the project directory.

---

## 🧩 Installing Skills for AI Agents

A key feature of **openapi-skills** is the built-in skill bundle, which many people use with AI tools such as GitHub Copilot, Claude, Cursor, and Codex to help explain API workflows and commands.

### Install all skills:

```bash
openapi-skills install --skills
```

This command installs:

- **SKILL.md** — the core agent workflow with reference files

Once installed, the agent becomes fully capable of:

- exploring APIs  
- generating client code  
- generating operation tests  
- validating requests  
- choosing the correct CLI commands automatically
- following your workflow without additional user guidance

---

### Best Practices and Tips for Using openapi-skills with AI Agents

To get the best results:
1. Open the `SKILL.md` file once so the workflow is available when you need it.
2. Always specify the API name you're working on from `.openapi-skills/config.json`.
3. Ensure your `.openapi-skills/config.json` has a valid `baseUrl`.
4. If you are using an AI tool, mention that it should follow the instructions in `SKILL.md`.

## ⚡ Dereferencing Mode: Ultra Performance

For maximum performance, you can run:

```bash
openapi-skills generate <schema> --dereference
```

### Benefits:
- Eliminates `$ref` lookups at runtime  
- Produces a fully expanded schema tree  
- Significantly faster operation processing  
- Ideal for large APIs with deep nesting  

### Important:
**Dereferencing cannot be used with schemas that contain circular references.**  
If circular references exist, the CLI will detect them and instruct you to use the default safe mode instead. Per-operation dereferencing still occurs normally.
This is safe because it dereferences only the parts of the schema required for each operation, not the entire schema at once.

---

## 🧠 Examples of How to Prompt an Agent That Uses This Skill

### ⭐ High-Level Prompts (You Don’t Need to Think in Steps)

While the examples below demonstrate the step-by-step prompting style  
(parse → explore → operate → generate), you can also give **high-level goals**,  
and the CLI workflow will still be inferred from context.

For example:

```
Make a positive TypeScript test for the <operationId> operation
from the schema at https://www.example.com/openapi.json, using base URL: https://api.example.com
```

The CLI will parse the schema, locate the operation, prepare templates,  
The agent would generate client code if needed, and produce a complete working test —  
without requiring you to specify every intermediate step.

More examples of high-level prompts:

```
Generate a full multi-step live request scenario for creating a user,
logging in, and fetching their profile, using the schema at <url> with <baseUrl>.
```

```
Create a ready-to-run API client for all operations related to billing in <apiName>.
```

```
Validate the entire schema at <url> and summarize all issues.
```

---

### 1. Parsing a New OpenAPI Schema

```
Here’s an OpenAPI file. Parse it and get it ready for exploration:
<path-or-url>
```

---

### 2. Exploring Operations

```
Show me the first 10 operations in this API.
```

```
List all the GET operations under path: /users.
```

```
Find operations related to billing or invoices.
```

---

### 3. Building multi-step scenario workflow

```
Build a full scenario using the multi-step request flow.
Prepare addPet and getPetById at once, then use the returned pet id from addPet to drive getPetById.
Keep the scenario end-to-end and make each step explicit.
```

That workflow typically involves:

- prepare all steps at once with `openapi-skills request addPet getPetById --api <apiName>`
- inspect the first template with `openapi-skills get-operation addPet --request`
- patch and execute `addPet` with `openapi-skills request addPet --force --update-request '{"pet.name":"Fluffy"}'` using a single-quoted JSON string. Invalid JSON will cause the command to fail.
- inspect the response with `openapi-skills get-operation addPet --response`
- feed the returned id into `getPetById` as the next step in the chain

---

### 4. Generating Client Code

```
Generate client code for the <operationId> operation.
```

The agent will follow the client‑code scenario automatically.

---

### 5. Describing an Operation

```
I need the full raw schema for the <operationId> operation.
```

---

### 6. Validating a Live Request

```
Make a request to <operationId> and validate the response against the schema.
```

```
Update the request template for <operationId> with this data and then validate the response against the schema:
{ ... }
```

---

### 7. Setting Authentication

```
Use this auth token for the API:
{"Authorization": "Bearer <token>"}
```

---

### 8. Generating Operation Tests

```
Create a test file for the <operationId> operation.  
I'm using Jest.
```

```
Generate a Playwright API test for <operationId>.
```

That workflow typically involves:

- ensure client code exists  
- create `/test` or `/tests`  
- generate `<operationId>.test.ts`  
- use the client class, not raw HTTP  

---

### 9. Debugging a Failing Request

```
Validate the request and response for <operationId> and explain what’s wrong.
```

---

### 10. Regenerating a Request Template

```
Reset the request template for <operationId> to the schema defaults.
```

---

## 📘 CLI Command Overview

### install
Install `SKILL.md` and scenario markdowns.

This command installs the skill bundle layout used by the installer, including the reference markdown files.

```bash
openapi-skills install --skills
```

### generate
Parse an OpenAPI source and produce artifacts:

```
.openapi-skills/    # located in root directory
├── config.json
└── <apiName>/
    ├── endpoints.json
    └── schemas/
```

Supports:

- `--validate <schema>`  
- `--base-url <url>`  
- `--dereference`  
- `--rename <newName>`  
- `--no-progress`  

**Validation mode:**
Validates API definitions by resolving all references, checking structure against the official specification, and reporting any errors. To validate a schema only (no output files), use:

```bash
openapi-skills generate --validate ./openapi.yaml
```

---

### list
List summarized operation metadata for a parsed API as JSON.

At least one filter input is required to list operations. The command accepts `--path`, `--filter`, `--method`, `--root-type`, or `--index` as filter inputs.

Supports:

- `--count` (returns the filtered/sliced operation count; with no filters, returns the total count)
- `--path` (prefix, `:param`, or segment matching)
- `--filter`
- `--method` for OpenAPI operations
- `--root-type` for GraphQL root types (`query`, `mutation`, or `subscription`)
- `--index`

If you intentionally want the entire list, use `--index :`.

`--method` and `--path` are used only with OpenAPI requests, and `--root-type` is used only with GraphQL requests. Each flag is optional, but none of them can be used outside their respective API types.

---

### generate-client-schema
Produce structured metadata for client code generation. This is the recommended first choice for operation inspection when you want client-ready shape information.

---

### describe
Fallback option: return the full raw schema for an operation when `generate-client-schema` is not sufficient.

---

### get-operation
Return one stored operation artifact as raw JSON. Run `openapi-skills request <operationId> --api <apiName>` first so the artifact exists for that same operationId.

Alias: `openapi-skills get-operation-artifact`.

Supports exactly one of:

- `--request`
- `--response`
- `--response-schema`

Example:

```bash
openapi-skills get-operation getPetById --api petstore --request
```

The alias works the same way:

```bash
openapi-skills get-operation-artifact getPetById --api petstore --request
```

Use `--get` to narrow the stored artifact first, then apply `--filter` to the narrowed result when the selected value is an array:

```bash
openapi-skills get-operation getPetById --api petstore --response --get body --filter id=555
```

`--filter` still works on its own for array artifacts, and `--get` still works on its own for deep values.

---

### request
Make a live HTTP request for an operation. When you pass multiple operationIds, the command switches to prepare-only mode and only refreshes request templates.

Supports:

- `--validate` (validate only the response against the schema after the request is sent; it does not validate the request body or guarantee a response exists, and it suppresses request/response output)
- `--force` (regenerate request.json; use before `--update-request` when you want the original schema-shaped template)
- `--update-request` (patch request.json; pass a JSON string of flattened dot-notation keys — single-quote in POSIX shells). Invalid JSON will cause the command to fail.
- `--header` (add headers)

Prepare-only mode:

- `openapi-skills request <operationId...> --api <apiName>` prepares templates for multiple operations without making live requests
- `--force` refreshes all templates from schema defaults
- `--validate`, `--update-request`, and `--header` are ignored in prepare-only mode
- The command prints a deterministic summary plus structured JSON metadata for each prepared operation

Live request validation:

```bash
openapi-skills request <operationId> --api <apiName> --validate
```

`--validate` checks only the response that comes back from the request. It does not block malformed request bodies before sending, and it does not guarantee that a response exists.

Batch template preparation:

```bash
openapi-skills request step1 step2 step3 --api <apiName>
```

Workflow for chained steps:

1. Prepare the templates for all steps with `openapi-skills request step1 step2 step3 --api <apiName>`.
2. Inspect a template with `openapi-skills get-operation <opId> --request` after `request` has created it.
3. Rebuild the template with `openapi-skills request <opId> --force` when you want the original schema-shaped request back.
4. Patch a request with `openapi-skills request <opId> --force --update-request '{"field.path":"value"}'` using a single-quoted JSON string. Invalid JSON will cause the command to fail.
5. Execute the request with `openapi-skills request <opId>`.
6. Inspect the response with `openapi-skills get-operation <opId> --response`.

---

### set-env
Set or update the runtime environment for a parsed API.

Supports:

- `--base-url` (persist the API base URL)
- `--auth` (persist authentication headers as JSON)
- `--var` (repeatable key=value runtime vars)

Example:

```bash
openapi-skills set-env --api petstore --base-url https://dev.example.com --auth '{"Authorization":"Bearer abc"}' --var userId=123
```

---

### get-env
Read runtime environment values (`baseUrl`, auth headers, vars) for a parsed API from `.openapi-skills/config.json`.

Usage:

```bash
openapi-skills get-env --api <apiName>
openapi-skills get-env --api petstore --base-url
openapi-skills get-env --api petstore --var userId
```

### get-api-names
List all parsed APIs in the project.
- Outputs JSON in the form `{"kind":"api-list","apiNames":[...]}`.

---

### help
Show the CLI help overview.

The `--silent` flag hides the banner in the help output.

### version
Show the CLI version.

---

### Walkthrough Video
https://github.com/user-attachments/assets/b462a57e-e2da-4556-9a96-1c8d5ffc9e0b

---

## License
MIT License  
Copyright © 2026  
Tzur Paldi  
Powered by Bedekbyte™

## Support
Email: tzur.paldi@outlook.com
