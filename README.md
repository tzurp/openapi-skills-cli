
# openapi-skills
API CLI with SKILLS
<p align="center">
<img src="https://raw.githubusercontent.com/tzurp/images/refs/heads/main/openapi-skills.png">
</p>

<h3 align="center"> A powerful command‑line toolkit for working with OpenAPI and GraphQL schemas.  
Use it manually like a fast, lightweight API explorer, or unlock its full potential by installing the built‑in Skill bundle, which teaches AI agents (Copilot, Claude, Cursor, etc.) how to operate the CLI through natural language.</h3>

With Skills enabled, openapi‑skills becomes an AI‑ready API engine: agents can explore your API, prepare and execute live requests, validate schemas, and even generate client code, tests, and workflows - all from simple, conversational instructions.

## Overview

`openapi-skills` helps developers work with API schemas efficiently. It parses OpenAPI and GraphQL definitions, generates structured artifacts, provides exploration tools, validates schemas, prepares request templates, and supports test generation. When the AI skills are installed, agents can understand your API and execute CLI commands automatically.

## Why openapi-skills

Working with API schemas can be slow and error‑prone. `openapi-skills` provides:

- A consistent way to explore any API  
- Automatic artifact generation  
- Request templates you can execute immediately  
- Built‑in validation tools  
- Optional AI integration for natural-language workflows  

## Manual CLI + AI Skills

openapi-skills works perfectly as a traditional CLI. You can explore endpoints, inspect schemas, prepare requests, and execute live API calls directly from the terminal.

Enable the optional Skill bundle, and AI agents (Copilot, Claude, Cursor, etc.) can operate the CLI for you: exploring operations, preparing and executing requests, validating schemas, and even generating client code, tests, and multi-step workflows from natural language.

## Features

- Explore operations by method, path, tag, or keyword  
- Describe endpoints with full request/response details  
- Prepare and execute live API requests (Postman‑like, no code needed)  
- Parse OpenAPI 2.0/3.x and GraphQL schemas  
- Generate artifacts (`endpoints.json`, `schemas/`)
- Work with multiple API schemas simultaneously (stored under: .openapi-skills/<apiName>/ directory)
- Validate schemas and API responses  
- Build multi-step scenarios  
- AI Skills bundle for agent-driven workflows (code, tests, clients, docs)

## Workflow

**parse → index → understand → execute → validate → generate code/tests (via agent)**

## Quick start

### Install the CLI

```bash
npm install -g openapi-skills
```

### Install the Skill

```bash
openapi-skills install --skills
```
Select your preferred path from  the menu and confirm

### Generate artifacts from a schema

```bash
openapi-skills generate https://petstore.swagger.io/v2/swagger.json --base-url=https://petstore.swagger.io/v2
```

This creates:

```
.openapi-skills/
  petstore/
    endpoints.json
    schemas/
```

### Explore the API manually

```bash
openapi-skills list --api petstore --method POST --index 0:10
openapi-skills list --api petstore --method GET --path /pet --tag pet
openapi-skills describe addPet --api petstore
```

### Prepare and execute a request manually

```bash
openapi-skills request addPet --api petstore --force --update-request '{"body.id":1,"body.name":"Fluffy"}'
```

---

## ⚡ One‑line agent command

Once the Skills bundle is installed, the entire Quick start can be replaced with a single natural-language instruction:

```
In Agent mode write: /openapi-skill make live request to addPet with name "Fluffy" using the schema https://petstore.swagger.io/v2/swagger.json and base url https://petstore.swagger.io/v2
```

The agent will:

- Parse the schema  
- Generate artifacts  
- Index endpoints  
- Prepare the request  
- Set `"name": "Fluffy"`  
- Execute it live  
- Show the response  

All from **one sentence**.

### Example questions you can ask the Skill if you feel stuck

You can always ask the skill question to progress in your work. For example:
 - `/openapi-skills what can you do?`
 - `/openapi-skills how do I add an auth token to a live request?`

---

## 5‑minute tutorial

### 1. Install the CLI

```bash
npm install -g openapi-skills
```

### Install the Skill

```bash
# Local install (default)
openapi-skills install --skills
```
```bash
# Global install (user home)
openapi-skills install --skills --global
```

During installation, the CLI shows a small menu where you choose the Skill’s location:

- `.cursor/skills/`
- `.agent/skills/`
- `.claude/skills/`
- `.github/skills/`
- `other` (custom path)

Select your preferred path and confirm — that’s it.

> **💡 Note:**
>
> Installing the skill bundle allows AI agents to understand your API structure and execute CLI commands automatically.  
> See the section on [AI agent capabilities](#ai-agent-capabilities-some-examples).


### 2. Parse a public API and set its base URL

```bash
openapi-skills generate https://petstore.swagger.io/v2/swagger.json --base-url=https://petstore.swagger.io/v2 --rename petstore-v2
```

### 3. Explore operations

```bash
openapi-skills list --api petstore --method POST --index 0
openapi-skills describe addPet --api petstore
```

### 4. Build and execute a request

```bash
openapi-skills request addPet --api petstore --force --update-request '{"body.id":1,"body.name":"Fluffy"}'
```

### 5. Validate the schema

```bash
openapi-skills generate https://petstore.swagger.io/v2/swagger.json --validate
```

## Examples of what AI agents can do when the Skill is enabled

| Natural language request | CLI/Skill executed |
|--------------------------|--------------------|
| “Make a live request to addPet with name Fluffy.” | Postman‑like API call via `request --update-request` |
| “Show me the first POST operation.” | Explore endpoints via `list` |
| “Describe the addPet operation.” | Operation breakdown via `describe` |
| “Validate this API schema.” | Schema validation via `generate --validate` |
| “Generate a Jest test for addPet.” | Agent writes full Jest test using CLI metadata |
| “Create a Playwright API test for addPet.” | Agent generates Playwright test using endpoint + schema |
| “Build a TypeScript API client for this API.” | Agent generates typed client functions + models |
| “Create a 3-step scenario: add, fetch, delete pet.” | Multi-step workflow via `request` |

Agents combine CLI output with code generation to produce:
- typed API clients  
- integration & contract tests  
- Playwright API tests  
- mocks & fixtures  
- multi-step workflows  
- documentation  

## 🎥 Video demo

A short video clip demonstrating the CLI in action is available here:

[https://github.com/tzurp/openapi-skills-cli/releases#release-video](https://github.com/tzurp/openapi-skills-cli/releases#release-video)

## Support

If you run into issues or have questions:

- Report bugs or request features via GitHub Issues: [https://github.com/tzurp/openapi-skills-cli/issues](https://github.com/tzurp/openapi-skills-cli/issues)
- General questions can be sent directly to: [tzur.paldi@outlook.com](mailto:tzur.paldi@outlook.com)
- Check CLI help for up-to-date usage:
  ```bash
  openapi-skills --help
  openapi-skills <command> --help
  ```

> **✨TIP**
>
> When opening an issue or sending an email, include the CLI version, the command you ran, and any relevant logs or schema snippets.

## Links

- npm package: [https://www.npmjs.com/package/openapi-skills](https://www.npmjs.com/package/openapi-skills)
- GitHub repository: [https://github.com/tzurp/openapi-skills-cli](https://github.com/tzurp/openapi-skills-cli)
```