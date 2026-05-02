import { Command } from "commander";
import parseOpenAPI, { validateSchema } from "./parser.js";
import fs from "fs-extra";
import path from "path";
import { getOpenapiToSkillsDir, getProjectRoot, getEndpointsPath, getOperationArtifactPath } from "./helper/paths.js";
import { ensureConfig, updateConfig, listApis, getConfigValue, listEndpoints, deleteApi } from "./index.js";
import { buildClientCodeSchema } from "./client-schema-builder.js";
import {} from "./helper/json-updater.js";
import { validateResponse, makeRequest } from "./validate-response.js";
import { createRequire } from "module";
import { promptInstallLocation, installSkillBundle } from "./install-skill.js";
import { ensureEndpointSchemaFile } from "./parser.js";
import { logger, emitJsonError, emitCommandError, logGeneratedPaths, toErrorMessage } from "./helper/logger.js";
import { filterEndpoints, filterResolvedEndpoints, sliceEndpointsByIndex } from "./helper/endpoint-filter.js";
import { getSanitizedOperationId } from "./helper/endpoint-utils.js";
import { checkForUpdateOncePerTerminalSession } from "./helper/update-check.js";
import { promptDeleteConfirmation } from "./helper/prompt-delete.js";
import { resolveSelectedArtifact } from "./helper/request-artifacts.js";
import { prepareMultiOperationRequests, getRequestResponseMetadata } from "./helper/request-preparation.js";
const require = createRequire(import.meta.url);
const pkg = require("../package.json");
await checkForUpdateOncePerTerminalSession(pkg.version);
const openapiToSkillsDir = getOpenapiToSkillsDir();
const program = new Command();
program.name("openapi-skills")
    .description("A command‑line tool for working with OpenAPI 2/3 schemas. Use it to explore API endpoints, validate and test requests, generate typed client‑code schemas, and produce skills for agent frameworks.")
    .version(pkg.version);
const banner = `
  \u001b[32m
 ▄▄▄  ▄▄▄▄  ▄▄▄▄▄ ▄▄  ▄▄  ▄▄▄  ▄▄▄▄  ▄▄      ▄▄▄▄ ▄▄ ▄▄ ▄▄ ▄▄    ▄▄     ▄▄▄▄ 
██▀██ ██▄█▀ ██▄▄  ███▄██ ██▀██ ██▄█▀ ██ ▄▄▄ ███▄▄ ██▄█▀ ██ ██    ██    ███▄▄ 
▀███▀ ██    ██▄▄▄ ██ ▀██ ██▀██ ██    ██     ▄▄██▀ ██ ██ ██ ██▄▄▄ ██▄▄▄ ▄▄██▀
\u001b[0m
`;
program.addHelpText("before", banner);
program.addHelpText("before", `
===================
 openapi-skills CLI
===================
`);
const startYear = 2026;
const currentYear = new Date().getFullYear();
const yearRange = `${startYear}-${currentYear}`;
program.addHelpText("after", `
-------------------------------------------------------------------------------
Copyright © ${yearRange} Tzur Paldi — Powered by Bedekbyte® All rights reserved
Support: tzur.paldi@outlook.com
Project: https://www.npmjs.com/package/openapi-skills
-------------------------------------------------------------------------------
`);
program
    .command("install")
    .description("Install SKILL.md and scenario markdowns for agent frameworks like Claude and GitHub Copilot. Supports: --skills.")
    .option("--skills", "Install SKILL.md files for agent frameworks.")
    .action(async (options) => {
    if (!options.skills) {
        await ensureConfig();
        logger.info(".openapi-skills directory and configuration installed. Use --skills to install SKILL.md files for agent frameworks.");
        return;
    }
    const cwd = getProjectRoot();
    const srcDir = cwd;
    const defaultInstallPath = path.join(cwd, "installed-skills");
    logger.info(`Source directory (copied): ${srcDir}`);
    const installPath = await promptInstallLocation(defaultInstallPath);
    logger.info(`Target install directory: ${installPath}`);
    try {
        const result = await installSkillBundle(srcDir, installPath);
        logger.info(`Skill bundle installed: ${JSON.stringify(result)}`);
    }
    catch (err) {
        logger.error(`Failed to install skill bundle: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
});
const generateCmd = program
    .command("generate [openapi-source]")
    .description("Parse an OpenAPI source (file path or URL) and generate endpoints.json, schemas/, and config.json. Run this command first for a new spec. Supports: --validate, --base-url, --dereference, --no-progress.")
    .option("--validate <schema>", "Validate an OpenAPI schema (file path or URL) and exit")
    .option("--base-url <url>", "Base URL for the API")
    .option("--dereference", "Fully dereference the entire OpenAPI document before processing endpoints")
    .option("--no-progress", "Disable the progress indicator")
    .option("--rename <newName>", "Optional new name for the generated schema.")
    .action(async (openapiSource, options) => {
    try {
        if (typeof options.validate === "string" && options.validate.length > 0) {
            try {
                await validateSchema(options.validate);
                logger.result({
                    kind: "schema-validation",
                    valid: true,
                    schemaSource: options.validate,
                    message: "Schema is valid",
                });
                process.exitCode = 0;
            }
            catch (error) {
                logger.result({
                    kind: "schema-validation",
                    valid: false,
                    schemaSource: options.validate,
                    message: "Schema validation failed",
                    error: toErrorMessage(error),
                });
                process.exitCode = 1;
            }
            return;
        }
        if (!openapiSource) {
            throw new Error("An OpenAPI source is required unless --validate is used.");
        }
        const providedBaseUrl = typeof options.baseUrl === "string" ? options.baseUrl.trim() : "";
        const baseUrlProvided = providedBaseUrl.length > 0;
        const baseUrl = baseUrlProvided ? providedBaseUrl : "";
        const apiName = await parseOpenAPI(openapiSource, baseUrl, { dereference: options.dereference === true, progress: options.progress !== false, rename: options.rename });
        const outDir = path.join(openapiToSkillsDir, apiName);
        const configPath = path.join(openapiToSkillsDir, "config.json");
        if (!baseUrlProvided) {
            const warningMessage = [
                `You haven't included --base-url for API "${apiName}".`,
                `If you need to make requests and validations, add baseUrl directly to .openapi-skills/config.json under apis.${apiName}.baseUrl.`,
                `Example:`,
                `{
  "apis": {
    "${apiName}": {
      "baseUrl": "https://petstore3.swagger.io/api/v3",
      "openapi-sorce": "https://petstore3.swagger.io/api/v3/openapi.json"
    }
  }
}`,
            ].join("\n");
            logger.warn(warningMessage);
            logger.result({
                kind: "generate-warning",
                apiName,
                openapiSource,
                warning: warningMessage,
            });
        }
        logger.result({
            kind: "generate-result",
            apiName,
            openapiSource,
            fileCount: 3,
        });
        logGeneratedPaths([
            `Generated files for ${apiName}:`,
            `- ${path.join(outDir, "endpoints.json")}`,
            `- ${path.join(outDir, "schemas")}`,
            `- ${configPath}`,
        ]);
        process.exitCode = 0;
    }
    catch (error) {
        logger.result({
            kind: options.validate ? "schema-validation" : "generate-result",
            valid: false,
            openapiSource,
            error: toErrorMessage(error),
        });
        process.exitCode = 1;
    }
});
generateCmd.agentMeta = {
    name: "generate",
    category: "Generation",
    usage: "openapi-skills generate [openapi-source] [--validate <schema>] [--base-url <url>] [--dereference] [--no-progress] [--rename <newName>]",
    description: "Generate endpoints.json, schemas/, and config.json from an OpenAPI source (file path or URL). This is the required first step for a new spec because most other commands read these parsed artifacts. Use --validate to check a schema and exit. Use --dereference only when the spec has no circular references for superior performance. Use --rename to override the generated API name when the source filename is not the desired output name. Use --no-progress to suppress the progress line.",
    arguments: [
        { name: "openapi-source", type: "path|url", required: false, positional: true, description: "OpenAPI source file path or URL." },
        { name: "validate", type: "path|url", required: false, flag: true, description: "Validate an OpenAPI schema and exit." },
        { name: "base-url", type: "string", required: false, flag: true, description: "Base URL for the generated API." },
        { name: "dereference", type: "boolean", required: false, flag: true, description: "Fully dereference the OpenAPI document before processing endpoints." },
        { name: "no-progress", type: "boolean", required: false, flag: true, description: "Disable the progress indicator." },
        { name: "rename", type: "string", required: false, flag: true, description: "Optional new name for the generated schema." }
    ],
    examples: [
        "openapi-skills generate ./petstore.yaml --base-url https://api.example.com",
        "openapi-skills generate https://example.com/openapi.yaml",
        "openapi-skills generate ./petstore.yaml --validate ./petstore.yaml",
        "openapi-skills generate ./petstore.yaml --dereference",
        "openapi-skills generate ./petstore.yaml --rename petstore-v2",
        "openapi-skills generate ./petstore.yaml --no-progress"
    ],
    returns: {
        type: "json",
        description: "Prints output directory and config.json path."
    },
    sideEffects: {
        writesFiles: true,
        readsFiles: true,
        network: true
    },
    constraints: {
        destructive: false,
        idempotent: false,
        requiresParsedApi: false
    },
    filesWritten: ["endpoints.json", "schemas/", "config.json"]
};
const listCmd = program
    .command("list")
    .description("List summarized endpoint objects for the specified API as JSON. Supports advanced --path filtering, --filter, --method, --resolved/--dereferenced, --index slicing, and --count for endpoint totals. At least one filter is required unless '--index : ' is used intentionally.")
    .requiredOption("--api <apiName>", "API name to use")
    .option("--count", "Return the number of endpoints after applying any list filters and index slicing. With no filters, returns the total endpoint count.")
    .option("--resolved, --dereferenced", "Show only endpoints that already have generated schema details saved.")
    .option("--path <path>", [
    "Filter endpoints by path structure. Repeatable; multiple values are ANDed.",
    "Supports:",
    "  - Path prefix: /users (matches endpoints whose path begins with /users)",
    "  - Parameter detection: :param (matches endpoints with any {param} in the path)",
    "  - Segment matching: 'store order' (matches endpoints whose path contains BOTH 'store' AND 'order' as segments, in any order)",
    "  - OR within a clause: 'store|shop' (matches endpoints whose path contains EITHER 'store' OR 'shop')",
    "  - Combined AND+OR: 'store order|shop item' (matches endpoints with both 'store' and 'order', OR both 'shop' and 'item')",
    "  - Multiple --path flags are ANDed: --path /store --path order (matches endpoints starting with /store AND containing 'order')",
    "",
    "Examples:",
    "  --path /users",
    "  --path :param",
    "  --path 'store order'",
    "  --path 'store|shop'",
    "  --path /store --path order"
].join("\n"), (value, previous) => {
    const values = Array.isArray(previous) ? previous : previous ? [previous] : [];
    return [...values, value];
})
    .option("--filter <filterPattern>", "Filter endpoints by keywords, operationId, path, summary, or description. Supports AND/OR (use spaces for AND, | for OR), e.g. --filter 'create account|register user'.")
    .option("--method <method>", "Filter endpoints by HTTP method (GET, POST, etc)")
    .option("--index <range>", "Slice the filtered results with inclusive Python-like range syntax, e.g. 0:10, 5:, :10, -1, or :")
    .action(async (options) => {
    const apiName = options.api;
    try {
        const endpointsPath = getEndpointsPath(apiName);
        const resolveRequested = options.resolved === true || options.dereferenced === true;
        const hasFilter = Boolean(options.path || options.filter || options.method || options.index || resolveRequested);
        const filterOpts = {};
        if (typeof options.path === "string" || Array.isArray(options.path))
            filterOpts.path = options.path;
        if (typeof options.filter === "string")
            filterOpts.filter = options.filter;
        if (typeof options.method === "string")
            filterOpts.method = options.method;
        if (!options.count && !hasFilter) {
            logger.result({
                kind: "endpoint-list-warning",
                apiName,
                valid: false,
                message: "The list command requires at least one filter to avoid returning a large, unbounded result set. Use --path, --filter, --method, or --index to narrow the results. To intentionally return the full object, use '--index : '.",
                suggestedFlags: ["--path", "--filter", "--method", "--index <range>"],
            });
            process.exitCode = 0;
            return;
        }
        if (fs.existsSync(endpointsPath) === false) {
            if (options.count) {
                logger.result({
                    kind: "endpoint-count",
                    apiName,
                    count: 0,
                    message: `No endpoints.json found for API "${apiName}". Generate the API first with: openapi-skills generate <openapi-source> [options]`
                });
                return;
            }
            logger.result({
                ok: false,
                error: {
                    type: "NoEndpointsFound",
                    message: `No endpoints found for "${apiName}". Run 'openapi-skills generate <openapi-source> [options]' to generate this API.`
                }
            });
            logger.warn(`No endpoints found for "${apiName}". This API name may be misspelled or not generated yet. (openapi-skills generate <openapi-source> [options])`);
            return;
        }
        const endpoints = await fs.readJson(endpointsPath);
        let filtered = filterEndpoints(endpoints, filterOpts);
        if (resolveRequested) {
            filtered = await filterResolvedEndpoints(apiName, filtered);
        }
        filtered = sliceEndpointsByIndex(filtered, options.index);
        if (options.count) {
            logger.result({
                kind: "endpoint-count",
                apiName,
                count: filtered.length,
            });
            return;
        }
        if (filtered.length === 0) {
            logger.result([]);
            if (options.path || options.filter || options.method || options.index || resolveRequested) {
                const pathValue = Array.isArray(options.path) ? options.path.join(", ") : options.path;
                const pathMsg = pathValue ? `path "${pathValue}"` : "";
                const filterMsg = options.filter ? `filter \"${options.filter}\"` : "";
                const methodMsg = options.method ? `method \"${options.method}\"` : "";
                const resolveMsg = resolveRequested ? `resolve` : "";
                const indexMsg = options.index ? `index \"${options.index}\"` : "";
                const msg = [pathMsg, filterMsg, methodMsg, resolveMsg, indexMsg].filter(Boolean).join(", ");
                logger.warn(`No endpoints matched the ${msg}.`);
            }
            return;
        }
        logger.result(filtered);
    }
    catch (error) {
        logger.result({
            kind: "endpoint-list",
            apiName,
            valid: false,
            error: toErrorMessage(error),
        });
        process.exitCode = 1;
    }
});
listCmd.agentMeta = {
    name: "list",
    category: "Navigation",
    usage: "openapi-skills list --api <apiName> [--count] [--resolved|--dereferenced] [--path <path>]... [--filter <pattern>] [--method <method>] [--index <range>]",
    description: [
        "List endpoint summaries for the specified API as JSON, preserving only operationId, method, path, summary, and description.",
        "At least one filter is required to list endpoints. --index is treated as a filter input as well, so the command can run when only an index slice is provided. When no filter is supplied, the command returns a structured warning payload instead of the full endpoint array.",
        "Use --count to return the number of endpoints after applying any list filters and index slicing. When no filters are supplied, it returns the total endpoint count and still emits a JSON count object instead of endpoint summaries.",
        "Use --resolved (alias --dereferenced) to show only endpoints that already have generated schema details saved.",
        "Filtering can focus the results of very long endpoint lists. Use --path for advanced path matching, --filter for keywords, --resolved for schema-ready endpoints, and --index to slice the result list. Filtering is case-insensitive and supports:",
        "- Path prefix: --path '/users' (matches endpoints whose path begins with the prefix)",
        "- Parameter detection: --path :param (matches endpoints that contain at least one '{...}' path placeholder)",
        "- Segment matching: --path 'store order' (matches endpoints whose path contains both segments)",
        "- OR within a single path clause: --path 'store|shop' (matches either segment)",
        "- Multiple path flags are ANDed: --path /store --path order",
        "- Simple substring filtering: --filter 'user account' (matches endpoints containing both 'user' and 'account' in any field)",
        "- OR filtering: --filter 'create|register|signup' (matches any endpoint containing any of the words)",
        "- Combined AND+OR: --filter 'create account|register user' (matches endpoints containing both 'create' and 'account', OR both 'register' and 'user')",
        "- Path substring search: --filter '/users' (matches endpoints whose path contains the substring)",
        "- OperationId: --filter 'getUser' (matches operationId field)",
        "- Summary/description: --filter 'delete permanently'",
        "- Method filtering: --method GET (can be combined with --path and/or --filter)",
        "- Index slicing: --index 0:10, --index 5:, --index :10, --index -1, --index :",
        "    Slices the filtered results using inclusive Python-like range syntax:",
        "      N         = only the Nth item (0-based, negative counts from end)",
        "      start:end = all items from start to end, inclusive",
        "      start:    = from start to last",
        "      :end      = from first to end",
        "      :         = all items",
        "    Negative indices count from the end (e.g., -1 is the last item, -2 is second-to-last).",
        "    Examples:",
        "      --index 0:2   (first three items)",
        "      --index 5:    (from 6th to last)",
        "      --index :3    (first four items)",
        "      --index -1    (last item)",
        "      --index :     (all items)",
        "      --count       (return the filtered/sliced endpoint count, or the total count when no filters are used)",
        "\n",
        "Use --path when you want path-aware matching. Use --filter when you want substring matching across path, operationId, summary, or description.",
        "Use --count when a user asks for the number of endpoints, such as 'count the endpoints for apiName' or 'how many endpoints does apiName have?'. The count should reflect the same path/filter/method/index criteria applied to list output.",
        "If no endpoints match, outputs [] and prints a message to stderr."
    ].join("\n"),
    arguments: [
        { name: "api", type: "string", required: true, flag: true, description: "API name to use." },
        { name: "count", type: "flag", required: false, flag: true, description: "Return the number of endpoints after filtering and slicing." },
        { name: "resolved", type: "flag", required: false, flag: true, description: "Show only endpoints that already have generated schema details saved. Alias: --dereferenced." },
        { name: "path", type: "string[]", required: false, flag: true, description: "Filter endpoints by path structure." },
        { name: "filter", type: "string", required: false, flag: true, description: "Filter endpoints by keywords, operationId, path, summary, or description." },
        { name: "method", type: "string", required: false, flag: true, description: "Filter endpoints by HTTP method." },
        { name: "index", type: "string", required: false, flag: true, description: "Slice the filtered results with inclusive Python-like range syntax." }
    ],
    examples: [
        "openapi-skills list --api petstore",
        "openapi-skills list --api petstore --count",
        "openapi-skills list --api petstore --resolved",
        "openapi-skills list --api petstore --path /users",
        "openapi-skills list --api petstore --path /store --path order",
        "openapi-skills list --api petstore --path 'store order'",
        "openapi-skills list --api petstore --path :param",
        "openapi-skills list --api petstore --filter addpet",
        "openapi-skills list --api petstore --filter 'create|register' --method POST",
        "openapi-skills list --api petstore --resolved --count",
        "openapi-skills list --api petstore --filter '/users'",
        "openapi-skills list --api petstore --index 0:10"
    ],
    returns: {
        type: "json",
        description: "Returns JSON output. When filters are provided, returns a JSON array of filtered endpoint summaries. When --count is used, returns a JSON object containing only the count. When no filters are provided, returns a structured JSON warning object instead of endpoint data."
    },
    sideEffects: {
        writesFiles: false,
        readsFiles: true,
        network: false
    },
    constraints: {
        destructive: false,
        idempotent: true,
        requiresParsedApi: true
    },
    filesWritten: []
};
const genClientSchemaCmd = program
    .command("generate-client-schema <operationId>")
    .requiredOption("--api <apiName>", "API name to use")
    .option("--force", "Overwrite the cached .openapi-skills/<api>/schemas/<operationId>.json file before generating metadata.")
    .description("Return structured metadata for client code generation for a specific endpoint. Use --force to overwrite the cached .openapi-skills/<api>/schemas/<operationId>.json file before reading it.")
    .action(async (operationId, options) => {
    const apiName = options.api;
    try {
        const sanitizedOperationId = await getSanitizedOperationId(apiName, operationId);
        const schema = await buildClientCodeSchema(apiName, operationId, sanitizedOperationId, options.force === true);
        logger.result(schema);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.result({
            error: "Error generating client code metadata",
            details: message,
        });
        logger.error(`Error generating client code metadata: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    }
});
genClientSchemaCmd.agentMeta = {
    name: "generate-client-schema",
    category: "Code Generation",
    usage: "openapi-skills generate-client-schema <operationId> --api <apiName> [--force]",
    description: "Print structured metadata optimized for client code generation as pretty-printed JSON. Works for all endpoints. Returns `response: null` for endpoints with no JSON response body (e.g., DELETE operations) — generate `Promise<void>` as the return type in that case. The cached .openapi-skills/<api>/schemas/<operationId>.json file is reused unless --force is provided, which overwrites the cached schema from the bundled API document before generating output.",
    arguments: [
        { name: "operationId", type: "string", required: true, positional: true, description: "The operationId of the endpoint to inspect." },
        { name: "api", type: "string", required: true, flag: true, description: "The API name as defined in .openapi-skills/config.json." },
        { name: "force", type: "flag", required: false, flag: true, description: "Overwrite the cached schema file before generating metadata." }
    ],
    examples: [
        "openapi-skills generate-client-schema addPet --api petstore",
        "openapi-skills generate-client-schema addPet --api petstore --force"
    ],
    returns: {
        type: "json",
        description: "Returns metadata as pretty-printed JSON."
    },
    sideEffects: {
        writesFiles: false,
        readsFiles: true,
        network: false
    },
    constraints: {
        destructive: false,
        idempotent: true,
        requiresParsedApi: true
    },
    filesWritten: []
};
const describeCmd = program
    .command("describe <operationId>")
    .requiredOption("--api <apiName>", "API name to use")
    .option("--force", "Overwrite the cached .openapi-skills/<api>/schemas/<operationId>.json file before printing the raw schema.")
    .description("describe → fallback for generate-client-schema. Use generate-client-schema first. Prints the complete raw schema for a specific endpoint as JSON, including all parameters, request body, and all response codes. The cached .openapi-skills/<api>/schemas/<operationId>.json file is reused unless --force is provided, which overwrites the cached schema from the bundled API document before output.")
    .action(async (operationId, options) => {
    const apiName = options.api;
    try {
        const sanitizedOperationId = await getSanitizedOperationId(apiName, operationId);
        const schema = await ensureEndpointSchemaFile(apiName, operationId, sanitizedOperationId, options.force === true);
        logger.result({
            kind: "describe-result",
            apiName,
            operationId,
            warnings: ["describe → fallback for generate-client-schema. Use openapi-skills generate-client-schema first for client code generation. Use describe only when you need the full raw schema detail."],
            schema,
        });
        return;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emitJsonError("Error describing endpoint", message);
        emitCommandError("Error describing endpoint", message);
        process.exitCode = 1;
        return;
    }
});
describeCmd.agentMeta = {
    name: "describe",
    category: "Navigation",
    usage: "openapi-skills describe <operationId> --api <apiName> [--force]",
    description: [
        "describe → fallback for generate-client-schema. Use generate-client-schema first. Prints the complete raw schema for a specific endpoint as JSON, including all parameters, request body, and all response codes. The cached .openapi-skills/<api>/schemas/<operationId>.json file is reused unless --force is provided, which overwrites the cached schema from the bundled API document before output.",
        "",
        "**Agents MUST use `generate-client-schema` for client code generation. Use `describe` only as a fallback when you need full raw schema detail beyond what `generate-client-schema` provides, or when `generate-client-schema` is insufficient.**"
    ].join("\n"),
    arguments: [
        { name: "operationId", type: "string", required: true, positional: true, description: "The operationId of the endpoint to describe." },
        { name: "api", type: "string", required: true, flag: true, description: "The API name as defined in .openapi-skills/config.json." },
        { name: "force", type: "flag", required: false, flag: true, description: "Overwrite the cached schema file before printing the raw schema." }
    ],
    examples: [
        "openapi-skills describe getPetById --api petstore",
        "openapi-skills describe deletePet --api petstore",
        "openapi-skills describe getPetById --api petstore --force"
    ],
    returns: {
        type: "json",
        description: "Structured JSON with a fallback warning and the raw OpenAPI schema nested under `schema`."
    },
    sideEffects: {
        writesFiles: false,
        readsFiles: true,
        network: false
    },
    constraints: {
        destructive: false,
        idempotent: true,
        requiresParsedApi: true
    },
    filesWritten: []
};
const getOperationCmd = program
    .command("get-operation <operationId>")
    .requiredOption("--api <apiName>", "API name to use")
    .option("--request", "Return request.json for the operation.")
    .option("--response", "Return response.json for the operation.")
    .option("--response-schema", "Return response-schema.json for the operation.")
    .description("Return one stored operation artifact as JSON. Run `request` first for the same operationId so the artifact exists. Exactly one of --request, --response, or --response-schema is required.")
    .action(async (operationId, options) => {
    const apiName = options.api;
    const selection = resolveSelectedArtifact(options);
    const sanitizedOperationId = await getSanitizedOperationId(apiName, operationId);
    if (selection.error || !selection.artifactName) {
        logger.error(selection.error ?? "Invalid operation artifact selection.");
        process.exitCode = 1;
        return;
    }
    const artifactPath = getOperationArtifactPath(apiName, sanitizedOperationId, selection.artifactName);
    if (!(await fs.pathExists(artifactPath))) {
        logger.error(`Artifact not found: ${artifactPath}`);
        process.exitCode = 1;
        return;
    }
    try {
        const artifact = await fs.readJson(artifactPath);
        logger.result(artifact);
    }
    catch (error) {
        logger.error(`Failed to read artifact ${artifactPath}: ${toErrorMessage(error)}`);
        process.exitCode = 1;
    }
});
getOperationCmd.agentMeta = {
    name: "get-operation",
    category: "Navigation",
    usage: "openapi-skills get-operation <operationId> --api <apiName> [--request] [--response] [--response-schema]",
    description: "Return a stored operation artifact created by `openapi-skills request` as raw JSON. Run `request` for the same operationId first so the artifact exists. The first example shows that prerequisite request step. Exactly one selector flag is required.",
    arguments: [
        { name: "operationId", type: "string", required: true, positional: true, description: "The operationId whose stored artifact should be returned." },
        { name: "api", type: "string", required: true, flag: true, description: "The API name as defined in .openapi-skills/config.json." },
        { name: "request", type: "flag", required: false, flag: true, description: "Return request.json for the operation." },
        { name: "response", type: "flag", required: false, flag: true, description: "Return response.json for the operation." },
        { name: "response-schema", type: "flag", required: false, flag: true, description: "Return response-schema.json for the operation." }
    ],
    examples: [
        "openapi-skills request getPetById --api petstore --force",
        "openapi-skills get-operation getPetById --api petstore --request",
        "openapi-skills get-operation getPetById --api petstore --response",
        "openapi-skills get-operation getPetById --api petstore --response-schema"
    ],
    returns: {
        type: "json",
        description: "Returns the selected artifact as raw JSON."
    },
    sideEffects: {
        writesFiles: false,
        readsFiles: true,
        network: false
    },
    constraints: {
        destructive: false,
        idempotent: true,
        requiresParsedApi: true
    },
    filesWritten: []
};
const requestCmd = program
    .command("request <operationId...>")
    .description("Make a live HTTP request for a specific endpoint, or prepare multiple request templates without executing requests. Supports: --validate (validate response), --force (regenerate request.json; use it when you want the original schema-shaped template), --update-request (patch request.json; only flattened object dot-notation keys are allowed), --header (add headers).")
    .requiredOption("--api <apiName>", "API name to use")
    .option("--validate", "Validate the response against the schema.")
    .option("--force", "Force overwrite request.json file with default values. Use this when you want the original schema-shaped template; omit it if you want to keep previous request values.")
    .option("--update-request <json>", [
    "Update request.json before making the request using a single-quoted JSON string that represents a flattened object with dot-notation keys.",
    "Nested JSON objects are supported (they will be flattened and issue a warning), but the top-level value must be a JSON object. Invalid JSON will cause the command to fail.",
    "Format (POSIX shells): --update-request '{\"field.path\":value,...}'",
    "Format (PowerShell): --update-request \"{\"field.path\":value,...}\"  (escape inner quotes as needed)",
    "  - Only flattened object dot-notation keys are recommended (e.g. 'items.0.name').",
    "Examples:",
    "   --update-request '{\"person.id\":\"2\"}'",
    "   --update-request '{\"items.0.name\":\"Alice\",\"items.1.value\":42}'",
    "   --update-request '{\"address.street\":\"Main St\",\"address.zip\":12345}'",
    "Note: The CLI runs JSON.parse on the provided value; if parsing fails the command exits with an error."
].join("\n"))
    .option("--header <json>", [
    "Additional headers as a JSON string (merged with config and defaults).",
    "Format: --header '{\"Header-Name\":\"value\"}'",
    "Example:",
    "  --header '{\"X-Api-Key\":\"abc\"}'"
].join("\n"))
    .action(async (operationIds, options) => {
    const apiName = options.api;
    if (operationIds.length > 1) {
        try {
            const { summaryText, payload } = await prepareMultiOperationRequests(apiName, operationIds, options.force === true);
            logger.result(`${summaryText}\n`);
            process.exitCode = 0;
        }
        catch (error) {
            const message = toErrorMessage(error);
            const payload = {
                kind: "request-result",
                apiName,
                preparedOnly: true,
                operationIds,
                valid: false,
                error: message,
            };
            logger.result(payload);
            logger.error(`Prepare-only request error for ${apiName}: ${message}`);
            process.exitCode = 1;
        }
        return;
    }
    const operationId = operationIds[0];
    if (!operationId) {
        logger.error("An operationId is required.");
        process.exitCode = 1;
        return;
    }
    let requestJsonUpdates;
    if (options.updateRequest) {
        let updates;
        try {
            updates = JSON.parse(options.updateRequest);
        }
        catch (err) {
            const message = `Invalid JSON for --update-request: ${err instanceof Error ? err.message : String(err)}`;
            logger.error(message);
            process.exitCode = 2;
            return;
        }
        if (typeof updates !== "object" || Array.isArray(updates) || !updates || Object.keys(updates).length === 0) {
            logger.error("--update-request must be a non-empty JSON object (use flattened dot-notation keys). Example: --update-request '{\"field.path\":value}'");
            process.exitCode = 2;
            return;
        }
        requestJsonUpdates = updates;
    }
    let cliHeaders = undefined;
    if (options.header) {
        try {
            cliHeaders = JSON.parse(options.header);
            if (typeof cliHeaders !== "object" || Array.isArray(cliHeaders) || !cliHeaders) {
                throw new Error("--header must be a JSON object");
            }
        }
        catch (err) {
            const message = "Invalid --header JSON. Example: --header '{\"X-Api-Key\":\"abc\"}'";
            logger.result(message);
            logger.error(message);
            process.exitCode = 2;
            return;
        }
    }
    if (options.validate) {
        try {
            const result = await validateResponse(apiName, operationId, options.force, cliHeaders, requestJsonUpdates);
            const metadata = getRequestResponseMetadata(apiName, operationId);
            const requestJsonPath = getOperationArtifactPath(apiName, operationId, "request");
            const responseJsonPath = getOperationArtifactPath(apiName, operationId, "response");
            const responseSchemaPath = getOperationArtifactPath(apiName, operationId, "response-schema");
            logGeneratedPaths([
                `Request artifacts for ${apiName} ${operationId}:`,
                `- ${requestJsonPath}`,
                `- ${responseJsonPath}`,
                `- ${responseSchemaPath}`,
            ]);
            logger.result({
                kind: "validation-result",
                apiName,
                operationId,
                valid: result.valid,
                warnings: result.warnings ?? [],
                errors: result.errors ?? [],
                fileCount: metadata.fileCount,
            });
            process.exitCode = result.valid ? 0 : 1;
        }
        catch (error) {
            logger.result({
                kind: "validation-result",
                apiName,
                operationId,
                valid: false,
                errors: [toErrorMessage(error)],
                warnings: Array.isArray(error?.warnings) ? error.warnings : [],
            });
            logger.error(`Validation error for ${apiName} ${operationId}: ${toErrorMessage(error)}`);
            process.exitCode = 2;
            return;
        }
    }
    else {
        try {
            const { request, response, warnings } = await makeRequest(apiName, operationId, options.force, cliHeaders, requestJsonUpdates);
            const metadata = getRequestResponseMetadata(apiName, operationId);
            const requestJsonPath = getOperationArtifactPath(apiName, operationId, "request");
            const responseJsonPath = getOperationArtifactPath(apiName, operationId, "response");
            const responseSchemaPath = getOperationArtifactPath(apiName, operationId, "response-schema");
            logGeneratedPaths([
                `Request artifacts for ${apiName} ${operationId}:`,
                `- ${requestJsonPath}`,
                `- ${responseJsonPath}`,
                `- ${responseSchemaPath}`,
            ]);
            logger.result({
                kind: "request-result",
                apiName,
                operationId,
                warnings: warnings ?? [],
                fileCount: metadata.fileCount,
            });
            process.exitCode = 0;
        }
        catch (error) {
            logger.result({
                kind: "request-result",
                apiName,
                operationId,
                valid: false,
                error: toErrorMessage(error),
            });
            logger.error(`Request error for ${apiName} ${operationId}: ${toErrorMessage(error)}`);
            process.exitCode = 2;
            return;
        }
    }
});
requestCmd.agentMeta = {
    name: "request",
    category: "Validation",
    usage: "openapi-skills request <operationId...> --api <apiName> [--validate] [--force] [--update-request <json>] [--header <json>]",
    description: [
        "Make a live HTTP request for an endpoint, or prepare multiple request templates without executing requests.",
        "When multiple operationIds are supplied, the command enters prepare-only mode and only refreshes request.json templates.",
        "With --validate, validate the response against the schema.",
        "With --force, regenerate request.json from schema defaults. Use it with --update-request when you want the original schema-shaped template before patching, and skip it if you want to keep previous request values.",
        "With --update-request, patch request.json before sending using flattened dot-notation keys, such as user.profile.name or parameters.0.id. Nested JSON objects are accepted (they will be flattened and a warning emitted), but the provided value must be valid JSON. Invalid JSON will cause the command to fail. Use --force when you want to restore defaults and patch in the same run."
    ].join(" "),
    arguments: [
        { name: "operationId", type: "string[]", required: true, positional: true, description: "One or more operationIds to invoke. Multiple values switch the command into prepare-only mode." },
        { name: "api", type: "string", required: true, flag: true, description: "The API name as defined in .openapi-skills/config.json." },
        { name: "validate", type: "flag", required: false, flag: true, description: "Validate the response against the schema." },
        { name: "force", type: "flag", required: false, flag: true, description: "Force overwrite request.json with default values. Use this when you want the original schema-shaped template; omit it if you want to keep previous request values." },
        { name: "update-request", type: "json", required: false, flag: true, description: "Patch request.json before making the request. Only flattened object dot-notation keys are allowed. Use with --force to rebuild defaults first." },
        { name: "header", type: "json", required: false, flag: true, description: "Additional headers as a JSON string." }
    ],
    examples: [
        "openapi-skills request getPetById --api petstore",
        "openapi-skills request getPetById --api petstore --validate",
        "openapi-skills request getPetById --api petstore --force --update-request '{\"user.profile.name\":\"Ada\"}'",
        "openapi-skills request getPetById --api petstore --update-request '{\"user.profile.name\":\"Ada\"}'",
        "openapi-skills request getPetById --api petstore --update-request '{\"parameters.0.id\":1}'",
        "openapi-skills request operationId1 operationId2 --api petstore"
    ],
    returns: {
        type: "json",
        description: "Returns raw request and response for single-operation requests, or a structured batch preparation summary when multiple operationIds are supplied."
    },
    sideEffects: {
        writesFiles: true,
        readsFiles: true,
        network: true
    },
    constraints: {
        destructive: false,
        idempotent: false,
        requiresParsedApi: true
    },
    filesWritten: ["request.json", "response.json", "response-schema.json"]
};
const setEnvCmd = program
    .command("set-env")
    .requiredOption("--api <apiName>", "API name to use")
    .option("--base-url <url>", "Base URL for the API environment.")
    .option("--auth <json>", "Authentication headers as a JSON string.")
    .option("--var <key=value>", "Set a runtime variable for the API environment. Repeatable.", (value, previous) => {
    const values = Array.isArray(previous) ? previous : previous ? [previous] : [];
    return [...values, value];
})
    .description("Set or update the runtime environment for a parsed API.")
    .addHelpText('after', [
    "Use this command to set baseUrl, auth headers, and runtime vars for a parsed API.",
    "",
    "Examples:",
    "  set-env --api petstore --base-url https://dev.example.com --auth '{\"Authorization\":\"Bearer abc\"}'",
    "  set-env --api petstore --auth '{\"Authorization\":\"Bearer abc\"}'",
    "  set-env --api petstore --var userId=123"
].join("\n"))
    .action(async (options) => {
    const apiName = options.api;
    const providedBaseUrl = typeof options.baseUrl === "string" ? options.baseUrl.trim() : "";
    const baseUrl = providedBaseUrl.length > 0 ? providedBaseUrl : undefined;
    let auth;
    if (typeof options.auth === "string") {
        try {
            const parsedAuth = JSON.parse(options.auth);
            if (typeof parsedAuth !== "object" || Array.isArray(parsedAuth) || !parsedAuth) {
                throw new Error("Auth must be a JSON object");
            }
            auth = parsedAuth;
        }
        catch {
            logger.result({
                kind: "set-env-result",
                apiName,
                success: false,
                error: "Invalid --auth JSON. Example: '{\"Authorization\":\"Bearer abc\"}'",
            });
            process.exitCode = 1;
            return;
        }
    }
    const rawVars = options.var ? (Array.isArray(options.var) ? options.var : [options.var]) : [];
    const vars = {};
    for (const entry of rawVars) {
        const separatorIndex = entry.indexOf("=");
        if (separatorIndex <= 0) {
            logger.result({
                kind: "set-env-result",
                apiName,
                success: false,
                error: `Invalid --var value \"${entry}\". Use key=value.`,
            });
            process.exitCode = 1;
            return;
        }
        const key = entry.slice(0, separatorIndex).trim();
        const value = entry.slice(separatorIndex + 1);
        if (!key) {
            logger.result({
                kind: "set-env-result",
                apiName,
                success: false,
                error: `Invalid --var value \"${entry}\". Use key=value.`,
            });
            process.exitCode = 1;
            return;
        }
        vars[key] = value;
    }
    try {
        const configUpdates = {};
        if (baseUrl !== undefined)
            configUpdates.baseUrl = baseUrl;
        if (auth !== undefined)
            configUpdates.auth = auth;
        if (Object.keys(vars).length > 0)
            configUpdates.vars = vars;
        await updateConfig(apiName, configUpdates);
        logger.result({
            kind: "set-env-result",
            apiName,
            success: true,
        });
    }
    catch (error) {
        logger.result({
            kind: "set-env-result",
            apiName,
            success: false,
            error: toErrorMessage(error),
        });
        process.exitCode = 1;
    }
});
setEnvCmd.agentMeta = {
    name: "set-env",
    category: "Configuration",
    usage: "openapi-skills set-env --api <apiName> [--base-url <url>] [--auth <json>] [--var key=value]",
    description: "Set or update the runtime environment for a parsed API. Persists baseUrl, auth headers, and named vars in config.json. Calling set-env again updates only the provided fields, which makes it the single command for switching environments.",
    arguments: [
        { name: "api", type: "string", required: true, flag: true, description: "The API name as defined in .openapi-skills/config.json." },
        { name: "base-url", type: "string", required: false, flag: true, description: "Base URL for the API environment." },
        { name: "auth", type: "json", required: false, flag: true, description: "Authentication headers as a JSON object." },
        { name: "var", type: "string", required: false, flag: true, description: "Runtime variable in key=value form. Repeatable." }
    ],
    examples: [
        "openapi-skills set-env --api petstore --base-url https://dev.example.com --auth '{\"Authorization\":\"Bearer abc\"}'",
        "openapi-skills set-env --api petstore --auth '{\"Authorization\":\"Bearer abc\"}'",
        "openapi-skills set-env --api petstore --var userId=123 --var env=staging"
    ],
    returns: {
        type: "json",
        description: "Returns success or error message."
    },
    sideEffects: {
        writesFiles: true,
        readsFiles: true,
        network: false
    },
    constraints: {
        destructive: false,
        idempotent: false,
        requiresParsedApi: false
    },
    filesWritten: ["config.json"]
};
const getEnvCmd = program
    .command("get-env")
    .requiredOption("--api <apiName>", "API name to use")
    .option("--base-url", "Include baseUrl in output")
    .option("--auth", "Include auth headers in output")
    .option("--var <key=value>", "Request one or more runtime vars. Repeatable; only the key part is used to filter output.", (value, previous) => {
    const values = Array.isArray(previous) ? previous : previous ? [previous] : [];
    return [...values, value];
})
    .description("Read API environment configuration from `.openapi-skills/config.json`. Returns all values unless a specific field is requested via flags.")
    .action(async (options) => {
    const apiName = options.api;
    try {
        const wantBase = options.baseUrl === true;
        const wantAuth = options.auth === true;
        const rawVars = options.var ? (Array.isArray(options.var) ? options.var : [options.var]) : [];
        const wantAny = wantBase || wantAuth || rawVars.length > 0;
        const baseUrl = await getConfigValue(apiName, "baseUrl");
        const authHeaders = await getConfigValue(apiName, "authHeaders");
        const varsEntriesRaw = await getConfigValue(apiName, "vars");
        const varsEntries = Array.isArray(varsEntriesRaw) ? varsEntriesRaw : [];
        const varsObj = Object.fromEntries(varsEntries);
        const resultPayload = { kind: "get-env-result", apiName };
        if (!wantAny || wantBase)
            resultPayload.baseUrl = baseUrl;
        if (!wantAny || wantAuth)
            resultPayload.authHeaders = authHeaders;
        if (!wantAny) {
            resultPayload.vars = varsEntries;
        }
        else if (rawVars.length > 0) {
            const keys = rawVars.map(entry => {
                const idx = entry.indexOf("=");
                return idx >= 0 ? entry.slice(0, idx).trim() : entry.trim();
            }).filter(Boolean);
            resultPayload.vars = keys.map(k => [k, varsObj[k]]).filter(([k, v]) => v !== undefined);
        }
        resultPayload.success = true;
        logger.result(resultPayload);
        process.exitCode = 0;
    }
    catch (err) {
        logger.result({
            kind: "get-env-result",
            apiName,
            success: false,
            error: err instanceof Error ? err.message : String(err),
        });
        process.exitCode = 1;
    }
});
getEnvCmd.agentMeta = {
    name: "get-env",
    category: "Configuration",
    usage: "openapi-skills get-env --api <apiName>",
    description: "Read environment configuration for an API. Returns all values by default, or only a specific field when a flag is provided (e.g., `--base-url`, `--auth`, `--var <key>`).",
    arguments: [
        { name: "api", type: "string", required: true, flag: true, description: "The API name as defined in .openapi-skills/config.json." }
    ],
    examples: [
        "openapi-skills get-env --api petstore",
        "openapi-skills get-env --api petstore --base-url",
        "openapi-skills get-env --api petstore --var userId",
    ],
    returns: {
        type: "json",
        description: "Prints { apiName, baseUrl, authHeaders, vars } where vars is an entries array."
    },
    sideEffects: {
        writesFiles: false,
        readsFiles: true,
        network: false
    },
    constraints: {
        destructive: false,
        idempotent: true,
        requiresParsedApi: false
    },
    filesWritten: []
};
const getApiNamesCmd = program
    .command("get-api-names")
    .description("List all available API names (parsed OpenAPI bundles) in the project.")
    .action(async () => {
    try {
        const apiNames = await listApis();
        const payload = {
            kind: "api-list",
            apiNames,
        };
        logger.result(payload);
        if (!apiNames || apiNames.length === 0) {
            logger.warn("No APIs were generated yet. Run: openapi-skills generate <openapi-source> [options]");
        }
    }
    catch (error) {
        logger.result({
            ok: false,
            error: {
                type: "ListApisError",
                message: "Failed to list APIs. Run 'openapi-skills generate' to parse APIs first."
            }
        });
        logger.error(`Error listing APIs: ${error instanceof Error ? error.message : String(error)}. Try running 'openapi-skills generate' to parse APIs first.`);
        process.exitCode = 1;
    }
});
getApiNamesCmd.agentMeta = {
    name: "get-api-names",
    category: "Navigation",
    usage: "openapi-skills get-api-names",
    description: "List all available API names (parsed OpenAPI bundles) in the project. Output is always JSON: { kind: 'api-list', apiNames: [<apiName>, ...] }. Use this to discover which APIs are available for use with other commands.",
    arguments: [],
    examples: [
        "openapi-skills get-api-names"
    ],
    returns: {
        type: "json",
        description: "Returns { kind: 'api-list', apiNames: [<apiName>, ...] } as JSON."
    },
    sideEffects: {
        writesFiles: false,
        readsFiles: true,
        network: false
    },
    constraints: {
        destructive: false,
        idempotent: true,
        requiresParsedApi: false
    },
    filesWritten: []
};
const removeApiCmd = program
    .command("remove-api <apiName>")
    .description("Remove an API from config.json and delete its .openapi-skills directory after confirmation.")
    .option("-y, --yes", "Confirm removal automatically without prompting.")
    .action(async (apiName, options) => {
    const targetApiName = apiName;
    try {
        const apiNames = await listApis();
        if (!apiNames.includes(targetApiName)) {
            const payload = {
                ok: false,
                error: {
                    type: "ApiNotFound",
                    message: `API '${targetApiName}' is not installed.`,
                },
            };
            logger.result(payload);
            logger.error(`Remove API error for ${targetApiName}: API '${targetApiName}' is not installed.`);
            process.exitCode = 1;
            return;
        }
        const confirmed = options?.yes === true ? true : await promptDeleteConfirmation(targetApiName);
        if (!confirmed) {
            logger.result({ ok: false, message: "Cancelled" });
            process.exitCode = 0;
            return;
        }
        const result = await deleteApi(targetApiName);
        logger.result(result);
        if (result.ok) {
            process.exitCode = 0;
            return;
        }
        logger.error(`Remove API error for ${targetApiName}: ${result.error.message}`);
        process.exitCode = 1;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.result({
            ok: false,
            error: {
                type: /config/i.test(message) ? "ConfigError" : "RemoveApiError",
                message,
            },
        });
        logger.error(`Remove API error for ${targetApiName}: ${message}`);
        process.exitCode = 1;
    }
});
removeApiCmd.agentMeta = {
    name: "remove-api",
    category: "Configuration",
    usage: "openapi-skills remove-api <apiName> [--yes|-y]",
    description: "Remove a parsed API after confirmation. The command deletes the API entry from config.json and removes the API directory under .openapi-skills.",
    arguments: [
        { name: "apiName", type: "string", required: true, positional: true, description: "The API name to remove." },
        { name: "yes", type: "flag", required: false, flag: true, description: "Confirm removal automatically without prompting." }
    ],
    examples: [
        "openapi-skills remove-api petstore --yes"
    ],
    returns: {
        type: "json",
        description: "Returns a structured success or error result for the deletion operation."
    },
    sideEffects: {
        writesFiles: true,
        readsFiles: true,
        network: false
    },
    constraints: {
        destructive: true,
        idempotent: false,
        requiresParsedApi: true
    },
    filesWritten: ["config.json"]
};
const helpCmd = program
    .command("help")
    .description("Show a complete overview of the CLI")
    .action(() => {
    logger.info("openapi-skills Help");
    logger.warn("--------------------------------------------------------------------------------------------------------------------");
    logger.info("Heads up: This command prints structured (machine-friendly) output. For normal help text, use `openapi-skills --help`.");
    logger.warn("--------------------------------------------------------------------------------------------------------------------\n");
    const excluded = new Set(["install", "help"]);
    const filteredCommands = program.commands.filter(cmd => !excluded.has(cmd.name()));
    logger.result({
        kind: "help-summary",
        usage: "openapi-skills help",
        commandCount: filteredCommands.length,
        commands: filteredCommands.map(command => ({
            name: command.agentMeta?.name ?? command.name(),
            usage: command.agentMeta?.usage ?? command.usage(),
            description: command.agentMeta?.description ?? command.description(),
            category: command.agentMeta?.category ?? "",
            arguments: command.agentMeta?.arguments ?? [],
            examples: command.agentMeta?.examples ?? [],
            returns: command.agentMeta?.returns ?? null,
            sideEffects: command.agentMeta?.sideEffects ?? null,
            constraints: command.agentMeta?.constraints ?? null,
            filesWritten: command.agentMeta?.filesWritten ?? [],
        })),
    });
});
export { program };
program.parse(process.argv);
//# sourceMappingURL=cli.js.map