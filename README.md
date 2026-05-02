# openapi-skills
OpenAPI CLI with SKILLS
<p align="center">
<img src="https://raw.githubusercontent.com/tzurp/images/refs/heads/main/openapi-skills.png">
</p>

Command‑line tools for exploring, validating, and generating artifacts from OpenAPI/Swagger specifications.  
Includes a built‑in, schema‑agnostic skill bundle that teaches AI agents how to operate the CLI.

---

## Core Capabilities

- Explore and inspect OpenAPI 2.0/3.x schemas  
- Parse specs into structured artifacts (`endpoints.json`, `schemas/`)  
- List endpoints, filter by method, structured path matching, or keywords  
- Describe endpoints with full raw schema detail  
- Retrieve stored operation artifacts (`request.json`, `response.json`, `response-schema.json`)  
- Validate live API requests and responses against the OpenAPI contract  
- Generate typed client metadata for TypeScript/JavaScript SDKs  
- Create and update request templates (`request.json`)  
- Manage and persist authentication headers  
- Generate endpoint tests from scenario descriptions  

---

## About the Skills

openapi-skills ships with a built‑in skill bundle for AI agents.  
These skills:

- are **generic**  
- are **schema‑agnostic**  
- teach agents **how to use the CLI**, not how to call your API  

Your OpenAPI specification is used to generate **artifacts** (schemas, validators, tests).  
The skills simply tell agents *how to run the tool*.

---

## 📦 Installation

```bash
npm install -g openapi-skills
```

---

## 🧩 Installing Skills for AI Agents

A key feature of **openapi-skills** is the ability to install a complete skill bundle that AI agents (GitHub Copilot, Claude, Cursor, etc.) can use to understand your API and follow your workflow automatically.

### Install all skills:

```bash
openapi-skills install --skills
```

This command installs:

- **SKILL.md** — the core agent workflow with reference files 

Once installed, the agent becomes fully capable of:

- exploring APIs  
- generating client code  
- generating endpoint tests  
- validating requests  
- choosing the correct CLI commands automatically
- following your workflow without additional user guidance

---

### Best Practices and Tips for Using openapi-skills with AI Agents

To get the best results:
1. Use a agent/model that supports SKILL.md-style workflows.
2. Open the SKILL.md file once so the agent loads the workflow (helpful but not required).
3. Always specify the API name you're working on from `.openapi-skills/config.json`.
4. Add “Follow the openapi-skills instructions in SKILL.md” to your prompt at least once.
5. Ensure your config.json has a valid baseUrl.

## ⚡ Dereferencing Mode: Ultra Performance

For maximum performance, you can run:

```bash
openapi-skills generate <schema> --dereference
```

### Benefits:
- Eliminates `$ref` lookups at runtime  
- Produces a fully expanded schema tree  
- Significantly faster endpoint processing  
- Ideal for large APIs with deep nesting  

### Important:
**Dereferencing cannot be used with schemas that contain circular references.**  
If circular references exist, the CLI will detect them and instruct you to use the default safe mode instead.

---

## 🧠 Examples of How to Prompt an Agent That Uses This Skill

These examples show how agents interpret natural language and automatically choose the correct CLI commands.

---

## 1. Parsing a New OpenAPI Schema

```
Here’s an OpenAPI file. Parse it and get it ready for exploration:
<path-or-url>
```

---

## 2. Exploring Endpoints

```
Show me the first 10 endpoints in this API.
```

```
List the all the GET endpoints under path: /users.
```

```
Find endpoints related to billing or invoices.
```

---

## 3. Building multi-step scenario workflow

```
Build a full scenario using the multi-step request flow.
Prepare addPet and getPetById at once, then use the returned pet id from addPet to drive getPetById.
Keep the scenario end-to-end and make each step explicit.
```

The agent will:

- prepare all steps at once with `openapi-skills request addPet getPetById --api <apiName>`
- inspect the first template with `openapi-skills get-operation addPet --request`
 - patch and execute `addPet` with `openapi-skills request addPet --force --update-request '{"pet.name":"Fluffy"}'` using a single-quoted JSON string. Invalid JSON will cause the command to fail.
- inspect the response with `openapi-skills get-operation addPet --response`
- feed the returned id into `getPetById` as the next step in the chain

---

## 4. Generating Client Code

```
Generate client code for the <operationId> endpoint.
```

The agent will follow the client‑code scenario automatically.

---

## 5. Describing an Endpoint

```
I need the full raw schema for the <operationId> endpoint.
```

---

## 6. Validating a Live Request

```
Make a request to <operationId> and validate it.
```

```
Update the request template for <operationId> with this data and then validate it:
{ ... }
```

---

## 7. Setting Authentication

```
Use this auth token for the API:
{"Authorization": "Bearer <token>"}
```

---

## 8. Generating Endpoint Tests

```
Create a test file for the <operationId> endpoint.  
I'm using Jest.
```

```
Generate a Playwright API test for <operationId>.
```

The agent will:

- ensure client code exists  
- create `/test` or `/tests`  
- generate `<operationId>.test.ts`  
- use the client class, not raw HTTP  

---

## 9. Validating an Entire Schema

```
Validate this OpenAPI schema:
<path-or-url>
```

---

## 10. Debugging a Failing Request

```
Validate the request and response for <operationId> and explain what’s wrong.
```

---

## 11. Regenerating a Request Template

```
Reset the request template for <operationId> to the schema defaults.
```

---

## 📘 CLI Command Overview

### install
Install SKILL.md and scenario markdowns for agent frameworks.

This command installs the skill bundle layout used by the installer, including the reference markdown files.

```bash
openapi-skills install --skills
```

### generate
Parse an OpenAPI source and produce:

- `endpoints.json`
- `schemas/`
- `config.json`

Supports:

- `--validate <schema>`  
- `--base-url <url>`  
- `--dereference`  
- `--rename <newName>`  
- `--no-progress`  

**Validation mode:**
Validates Swagger/OpenAPI definitions by resolving all references, checking structure against the official specification, and reporting any errors. To validate a schema only (no output files), use:

```bash
openapi-skills generate --validate ./openapi.yaml
```

---

### list
List summarized endpoint objects for a parsed API as JSON.

At least one filter input is required to list endpoints. The command accepts `--path`, `--filter`, `--method`, or `--index` as filter inputs.

Supports:

- `--count` (returns the filtered/sliced endpoint count; with no filters, returns the total count)
- `--path` (prefix, `:param`, or segment matching)
- `--filter`
- `--method`
- `--index`

If you intentionally want the entire list, use `--index : `.

---

### generate-client-schema
Produce structured metadata for client code generation. This is the recommended first choice for endpoint inspection when you want client-ready shape information.

---

### describe
Fallback-only: return the full raw schema for an endpoint when `generate-client-schema` is not sufficient.

---

### get-operation
Return one stored operation artifact as raw JSON. Run `openapi-skills request <operationId> --api <apiName>` first so the artifact exists for that same operationId.

Supports exactly one of:

- `--request`
- `--response`
- `--response-schema`

Example:

```bash
openapi-skills get-operation getPetById --api petstore --request
```

---

### request
Make a live HTTP request for an endpoint. When you pass multiple operationIds, the command switches to prepare-only mode and only refreshes request templates.

Supports:

- `--validate` (validate response, suppresses request/response output)
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
Read runtime environment values (baseUrl, auth headers, vars) for a parsed API from `.openapi-skills/config.json`.

Usage:

```bash
openapi-skills get-env --api <apiName>
openapi-skills get-env --api petstore --base-url
openapi-skills get-env --api petstore --var userId
```

### get-api-names
List all parsed APIs in the project.
- Outputs JSON in the form`{"kind":"api-list","apiNames":[...]}`.

---

### help
Show the CLI help overview.

### version
Show the CLI version.

---

## License
MIT License  
Copyright © 2026  
Tzur Paldi

## Support
Email: tzur.paldi@outlook.com
