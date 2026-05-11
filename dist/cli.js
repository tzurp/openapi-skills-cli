import { Command } from "commander";
import parseOpenAPI, { parseSchemaSource, validateSchema } from "./parser.js";
import fs from "fs-extra";
import path from "path";
import { getOpenapiToSkillsDir, getProjectRoot, getEndpointsPath, getOperationArtifactPath } from "./helper/paths.js";
import { ensureConfig, updateConfig, listApis, getConfigValue, deleteApi, getApiNotFoundResult, loadConfig } from "./index.js";
import { buildClientCodeSchema } from "./client-schema-builder.js";
import {} from "./helper/json-updater.js";
import { validateResponse, makeRequest, ensureResponseSchema, prepareRequestTemplate, collectRequestUpdateTypeWarnings, getSchemaType } from "./validate-response.js";
import { createRequire } from "module";
import { promptInstallLocation, installSkillBundle } from "./install-skill.js";
import { ensureEndpointSchemaFile } from "./parser.js";
import { logger, emitJsonError, emitCommandError, toErrorMessage } from "./helper/logger.js";
import { filterEndpoints, filterResolvedEndpoints, sliceEndpointsByIndex } from "./helper/endpoint-filter.js";
import { getSanitizedOperationId } from "./helper/endpoint-utils.js";
import { checkForUpdateOncePerTerminalSession } from "./helper/update-check.js";
import { getJsonOutputSize, MEDIUM_OUTPUT_MAX_BYTES } from "./helper/output-size.js";
import { promptDeleteConfirmation } from "./helper/prompt-delete.js";
import { collectRequestJsonPaths, collectUpdateRequestKeys, resolveSelectedArtifact } from "./helper/request-artifacts.js";
import { prepareMultiOperationRequests, getRequestResponseMetadata } from "./helper/request-preparation.js";
import { filterArray, getByPath } from "./helper/dotNotation.js";
import { parseGetOperationFilter } from "./helper/get-operation-filter.js";
const require = createRequire(import.meta.url);
const pkg = require("../package.json");
await checkForUpdateOncePerTerminalSession(pkg.version);
const openapiToSkillsDir = getOpenapiToSkillsDir();
const program = new Command();
const silentFlagRequested = process.argv.includes("--silent");
program.name("openapi-skills")
    .description("A command‑line tool for working with OpenAPI/Swagger specs. Use it to parse specs into artifacts, explore API endpoints, validate requests, generate typed client metadata, and teach AI agents how to operate the CLI and write API tests and client code.")
    .version(pkg.version);
async function guardApiName(apiName) {
    const apiNotFound = await getApiNotFoundResult(apiName);
    if (!apiNotFound) {
        return true;
    }
    logger.result(apiNotFound);
    logger.error(apiNotFound.message);
    process.exitCode = 1;
    return false;
}
const banner = `
  \u001b[32m
 ▄▄▄  ▄▄▄▄  ▄▄▄▄▄ ▄▄  ▄▄  ▄▄▄  ▄▄▄▄  ▄▄      ▄▄▄▄ ▄▄ ▄▄ ▄▄ ▄▄    ▄▄     ▄▄▄▄ 
██▀██ ██▄█▀ ██▄▄  ███▄██ ██▀██ ██▄█▀ ██ ▄▄▄ ███▄▄ ██▄█▀ ██ ██    ██    ███▄▄ 
▀███▀ ██    ██▄▄▄ ██ ▀██ ██▀██ ██    ██     ▄▄██▀ ██ ██ ██ ██▄▄▄ ██▄▄▄ ▄▄██▀
\u001b[0m
`;
program.option("--silent", "Suppress the banner in help output for agent-friendly usage.");
if (!silentFlagRequested) {
    program.addHelpText("before", banner);
}
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
        logger.info('openapi-skills skill bundle installed');
    }
    catch (err) {
        logger.error(`Failed to install skill bundle: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
});
const generateCmd = program
    .command("generate [openapi-source]")
    .description("Parse an OpenAPI or GraphQL source (file path or URL) and generate endpoints.json, schemas/, and config.json. Run this command first for a new spec. Supports: --validate, --base-url, --dereference, --no-progress.")
    .option("--validate <schema>", "Validate an OpenAPI or GraphQL schema (file path or URL) and exit")
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
        const apiName = await parseSchemaSource(openapiSource, baseUrl, { dereference: options.dereference === true, progress: options.progress !== false, rename: options.rename });
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
    .description("List summarized endpoint objects for the specified API as JSON. Supports --filter, --resolved/--dereferenced, --index slicing, and --count for endpoint totals. Also supports OpenAPI‑only options (--path, --method) and the GraphQL‑only option (--root-type). At least one filter is required unless --index : is used intentionally. GraphQL APIs reject --method and --path, and OpenAPI APIs reject --root-type.")
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
    .option("--filter <filterPattern>", "Filter endpoints by any of their searchable properties. Supports AND/OR (use spaces for AND, | for OR), e.g. --filter 'create account|register user'.")
    .option("--method <method>", "Filter endpoints by HTTP method (GET, POST, etc). Use this for OpenAPI endpoints.")
    .option("--root-type <rootType>", "Filter GraphQL root fields by root type (query, mutation, or subscription).")
    .option("--index <range>", "Slice the filtered results with inclusive Python-like range syntax, e.g. 0:10, 5:, :10, -1, or :")
    .action(async (options) => {
    const apiName = options.api;
    if (!(await guardApiName(apiName))) {
        return;
    }
    try {
        const endpointsPath = getEndpointsPath(apiName);
        const schemaType = await getSchemaType(apiName);
        const resolveRequested = options.resolved === true || options.dereferenced === true;
        const hasFilter = Boolean(options.path || options.filter || options.method || options.rootType || options.index || resolveRequested);
        const filterOpts = {};
        if (typeof options.path === "string" || Array.isArray(options.path))
            filterOpts.path = options.path;
        if (typeof options.filter === "string")
            filterOpts.filter = options.filter;
        if (typeof options.method === "string")
            filterOpts.method = options.method;
        if (typeof options.rootType === "string")
            filterOpts.rootType = options.rootType;
        if (schemaType === "graphql" && (typeof options.method === "string" || typeof options.path === "string")) {
            logger.result({
                kind: "endpoint-list-error",
                apiName,
                valid: false,
                schemaType,
                error: "--method and --path are only valid for OpenAPI APIs.",
            });
            logger.error("--method and --path are only valid for OpenAPI APIs.");
            process.exitCode = 2;
            return;
        }
        if (schemaType === "openapi" && typeof options.rootType === "string") {
            logger.result({
                kind: "endpoint-list-error",
                apiName,
                valid: false,
                schemaType,
                error: "--root-type is only valid for GraphQL APIs.",
            });
            logger.error("--root-type is only valid for GraphQL APIs.");
            process.exitCode = 2;
            return;
        }
        if (!options.count && !hasFilter) {
            logger.result({
                kind: "endpoint-list-warning",
                apiName,
                valid: false,
                message: "The list command requires at least one filter to avoid returning a large, unbounded result set. Use --path, --filter, --method, --root-type, or --index to narrow the results. Use --path and --method for OpenAPI and --root-type for GraphQL. To intentionally return the full object, use '--index : '.",
                suggestedFlags: ["--path", "--filter", "--method", "--root-type", "--index <range>"],
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
            if (options.path || options.filter || options.method || options.rootType || options.index || resolveRequested) {
                const pathValue = Array.isArray(options.path) ? options.path.join(", ") : options.path;
                const pathMsg = pathValue ? `path "${pathValue}"` : "";
                const filterMsg = options.filter ? `filter \"${options.filter}\"` : "";
                const methodMsg = options.method ? `method \"${options.method}\"` : "";
                const rootTypeMsg = options.rootType ? `rootType \"${options.rootType}\"` : "";
                const resolveMsg = resolveRequested ? `resolve` : "";
                const indexMsg = options.index ? `index \"${options.index}\"` : "";
                const msg = [pathMsg, filterMsg, methodMsg, rootTypeMsg, resolveMsg, indexMsg].filter(Boolean).join(", ");
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
    usage: "openapi-skills list --api <apiName> [--count] [--resolved|--dereferenced] [--path <path>]... [--filter <pattern>] [--method <method>] [--root-type <rootType>] [--index <range>]",
    description: [
        "List endpoint summaries for the specified API as JSON, preserving only operationId, method, path, summary, and description.",
        "At least one filter is required to list endpoints. --index is treated as a filter input as well, so the command can run when only an index slice is provided. When no filter is supplied, the command returns a structured warning payload instead of the full endpoint array.",
        "Use --count to return the number of endpoints after applying any list filters and index slicing. When no filters are supplied, it returns the total endpoint count and still emits a JSON count object instead of endpoint summaries.",
        "Use --resolved (alias --dereferenced) to show only endpoints that already have generated schema details saved.",
        "Filtering can focus the results of very long endpoint lists. Use --path for advanced path matching, --filter for keywords across OpenAPI and GraphQL endpoint fields, --method for OpenAPI HTTP methods, --root-type for GraphQL root types, --resolved for schema-ready endpoints, and --index to slice the result list. Filtering is case-insensitive and supports:",
        "- Path prefix: --path '/users' (matches endpoints whose path begins with the prefix)",
        "- Parameter detection: --path :param (matches endpoints that contain at least one '{...}' path placeholder)",
        "- Segment matching: --path 'store order' (matches endpoints whose path contains both segments)",
        "- OR within a single path clause: --path 'store|shop' (matches either segment)",
        "- Multiple path flags are ANDed: --path /store --path order",
        "- Simple substring filtering: --filter 'user account' (matches endpoints containing both 'user' and 'account' in any field, including GraphQL name/rootType fields)",
        "- OR filtering: --filter 'create|register|signup' (matches any endpoint containing any of the words)",
        "- Combined AND+OR: --filter 'create account|register user' (matches endpoints containing both 'create' and 'account', OR both 'register' and 'user')",
        "- Path substring search: --filter '/users' (matches endpoints whose path contains the substring)",
        "- OperationId: --filter 'getUser' (matches operationId field)",
        "- Summary/description: --filter 'delete permanently'",
        "- Method filtering: --method GET (OpenAPI only; can be combined with --path and/or --filter)",
        "- GraphQL root type filtering: --root-type query (query, mutation, or subscription)",
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
        "Use --path when you want path-aware matching. Use --filter when you want substring matching across path, operationId/name, rootType, summary, or description. Use --method for OpenAPI endpoints and --root-type for GraphQL endpoints.",
        "Use --count when a user asks for the number of endpoints, such as 'count the endpoints for apiName' or 'how many endpoints does apiName have?'. The count should reflect the same path/filter/method/rootType/index criteria applied to list output.",
        "If no endpoints match, outputs [] and prints a message to stderr."
    ].join("\n"),
    arguments: [
        { name: "api", type: "string", required: true, flag: true, description: "API name to use." },
        { name: "count", type: "flag", required: false, flag: true, description: "Return the number of endpoints after filtering and slicing." },
        { name: "resolved", type: "flag", required: false, flag: true, description: "Show only endpoints that already have generated schema details saved. Alias: --dereferenced." },
        { name: "path", type: "string[]", required: false, flag: true, description: "Filter endpoints by path structure." },
        { name: "filter", type: "string", required: false, flag: true, description: "Filter endpoints by keywords, operationId/name, rootType, path, summary, or description." },
        { name: "method", type: "string", required: false, flag: true, description: "Filter OpenAPI endpoints by HTTP method." },
        { name: "rootType", type: "string", required: false, flag: true, description: "Filter GraphQL endpoints by root type (query, mutation, or subscription)." },
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
        "openapi-skills list --api countries --root-type query",
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
    .option("--force", "Overwrite the cached <operationId> artifact file before generating metadata.")
    .description("Return structured metadata for client code generation for a specific endpoint. Use --force to overwrite the cached <operationId> artifact file before reading it.")
    .action(async (operationId, options) => {
    const apiName = options.api;
    if (!(await guardApiName(apiName))) {
        return;
    }
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
    description: "Print structured metadata optimized for client code generation as pretty-printed JSON. Works for all endpoints. Returns `response: null` for endpoints with no JSON response body (e.g., DELETE operations) — generate `Promise<void>` as the return type in that case. The cached <operationId> artifact file is reused unless --force is provided, which overwrites the cached schema from the bundled API document before generating output.",
    arguments: [
        { name: "operationId", type: "string", required: true, positional: true, description: "The operationId of the endpoint to inspect." },
        { name: "api", type: "string", required: true, flag: true, description: "The API name as defined in .openapi-skills/config.json." },
        { name: "force", type: "flag", required: false, flag: true, description: "Overwrite the cached artifact file before generating metadata." }
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
    .option("--force", "Overwrite the cached <operationId> artifact file before printing the raw schema.")
    .description("describe → fallback for generate-client-schema. Use generate-client-schema first. Prints the complete raw schema for a specific endpoint as JSON, including all parameters, request body, and all response codes. The cached <operationId> artifact file is reused unless --force is provided, which overwrites the cached schema from the bundled API document before output.")
    .action(async (operationId, options) => {
    const apiName = options.api;
    if (!(await guardApiName(apiName))) {
        return;
    }
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
        "describe → fallback for generate-client-schema. Use generate-client-schema first. Prints the complete raw schema for a specific endpoint as JSON, including all parameters, request body, and all response codes. The cached <operationId> artifact file is reused unless --force is provided, which overwrites the cached schema from the bundled API document before output.",
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
    .alias("get-operation-artifact")
    .requiredOption("--api <apiName>", "API name to use")
    .option("--request", "Return request artifact for the operation.")
    .option("--response", "Return response artifact for the operation.")
    .option("--response-schema", "Return response-schema artifact for the operation. Inspect this first when the response shape is unknown.")
    .option("--get <path>", "Select a nested value by dot-notation path first. Inspect --response-schema first so the path matches the actual response shape.")
    .option("--filter <expr>", "Filter the selected value using count, index, range, or <path>=<value> syntax (e.g. count, 0, 0:10, status=sold). Select path first with --get, then filter or slice the selected value.")
    .description("Return one stored operation artifact as JSON. Run `request` first for the same operationId so the artifact exists. Exactly one of --request, --response, or --response-schema is required. Select path first with --get, then apply --filter to the selected value. Use --response-schema first when the response shape is unknown.")
    .action(async (operationId, options) => {
    const apiName = options.api;
    if (!(await guardApiName(apiName))) {
        return;
    }
    const selection = resolveSelectedArtifact(options);
    const sanitizedOperationId = await getSanitizedOperationId(apiName, operationId);
    if (selection.error || !selection.artifactName) {
        logger.error(selection.error ?? "Invalid operation artifact selection.");
        process.exitCode = 1;
        return;
    }
    const artifactPath = getOperationArtifactPath(apiName, sanitizedOperationId, selection.artifactName);
    if (!(await fs.pathExists(artifactPath))) {
        logger.error(`Artifact not found: ${selection.artifactName}`);
        if (selection.artifactName === "response-schema") {
            logger.result({
                kind: "no-response-schema",
                apiName,
                operationId,
                error: "NoResponseSchema",
                message: "No response schema artifact found for this operation. Make a request first to generate the artifact."
            });
            process.exitCode = 1;
            return;
        }
    }
    try {
        let artifact = await fs.readJson(artifactPath);
        const getPath = typeof options.get === "string" ? options.get : undefined;
        const filterExpr = typeof options.filter === "string" ? options.filter : undefined;
        const hasGet = typeof getPath === "string" && getPath.length > 0;
        const hasFilter = typeof filterExpr === "string" && filterExpr.length > 0;
        const selectedValue = hasGet ? getByPath(artifact, getPath) : artifact;
        if (hasGet && !hasFilter) {
            const { sizeBytes } = getJsonOutputSize(selectedValue);
            if (sizeBytes >= MEDIUM_OUTPUT_MAX_BYTES) {
                logger.result({
                    kind: "oversized-output",
                    apiName,
                    artifactType: selection.artifactName,
                    operation: "--get",
                    sizeBytes,
                    maxBytes: MEDIUM_OUTPUT_MAX_BYTES,
                    message: "Output is too large. Use --filter or --get to reduce output."
                });
            }
            else {
                logger.result(selectedValue);
            }
            return;
        }
        if (hasFilter) {
            let artifactToFilter = selectedValue;
            let arrayFields = [];
            if (!Array.isArray(artifactToFilter) &&
                artifactToFilter !== null &&
                typeof artifactToFilter === "object") {
                arrayFields = Object.values(artifactToFilter)
                    .filter(v => Array.isArray(v));
                if (arrayFields.length === 1) {
                    artifactToFilter = arrayFields[0];
                }
            }
            const parsedFilter = parseGetOperationFilter(filterExpr);
            let result;
            if (parsedFilter.kind === "count" || parsedFilter.kind === "index" || parsedFilter.kind === "range") {
                const message = "--filter requires the target to be an array. Use --response-schema first to inspect the response shape, then use --get to narrow the value before filtering.";
                if (!Array.isArray(artifactToFilter)) {
                    if (arrayFields.length === 1) {
                        artifactToFilter = arrayFields[0];
                    }
                    else {
                        logger.result({
                            kind: "get-operation-artifact-filter-error",
                            apiName,
                            message,
                            selection: selection.artifactName,
                            filter: filterExpr,
                            selectedPath: hasGet ? getPath : undefined,
                        });
                        logger.error(message);
                        process.exitCode = 1;
                        return;
                    }
                }
                if (!Array.isArray(artifactToFilter)) {
                    logger.result({
                        kind: "get-operation-artifact-filter-error",
                        apiName,
                        message,
                        selection: selection.artifactName,
                        filter: filterExpr,
                        selectedPath: hasGet ? getPath : undefined,
                    });
                    logger.error(message);
                    process.exitCode = 1;
                    return;
                }
                if (parsedFilter.kind === "count") {
                    result = artifactToFilter.length;
                }
                else if (parsedFilter.kind === "index") {
                    const idx = parsedFilter.index < 0 ? artifactToFilter.length + parsedFilter.index : parsedFilter.index;
                    result = artifactToFilter[idx];
                }
                else {
                    result = artifactToFilter.slice(parsedFilter.start, parsedFilter.end);
                }
            }
            else if (parsedFilter.kind === "path") {
                const filterPath = parsedFilter.path;
                const rawValue = parsedFilter.value;
                let expectedValue = rawValue;
                if (hasGet && !Array.isArray(artifactToFilter)) {
                    logger.result({
                        kind: "get-operation-artifact-filter-error",
                        apiName,
                        message: "--filter requires the --get result to be an array. Use --response-schema first to inspect the response shape, then use --get to narrow the value before filtering.",
                        selection: selection.artifactName,
                        filter: filterExpr,
                        selectedPath: getPath,
                    });
                    logger.error("--filter requires the --get result to be an array. Use --response-schema first to inspect the response shape, then use --get to narrow the value before filtering.");
                    process.exitCode = 1;
                    return;
                }
                if (!Array.isArray(artifactToFilter)) {
                    const { sizeBytes } = getJsonOutputSize(artifactToFilter);
                    if (sizeBytes >= MEDIUM_OUTPUT_MAX_BYTES) {
                        logger.result({
                            kind: "oversized-output",
                            apiName,
                            artifactType: selection.artifactName,
                            operation: "--filter",
                            sizeBytes,
                            maxBytes: MEDIUM_OUTPUT_MAX_BYTES,
                            message: "Output is too large. Use --filter or --get to reduce output."
                        });
                    }
                    else {
                        logger.result(artifactToFilter);
                    }
                    return;
                }
                result = filterArray(artifactToFilter, filterPath, expectedValue);
            }
            else {
                logger.error("--filter must use count, index, range, or <path>=<value> syntax.");
                process.exitCode = 1;
                return;
            }
            const { sizeBytes } = getJsonOutputSize(result);
            if (sizeBytes >= MEDIUM_OUTPUT_MAX_BYTES) {
                logger.result({
                    kind: "oversized-output",
                    apiName,
                    artifactType: selection.artifactName,
                    operation: "--filter",
                    sizeBytes,
                    maxBytes: MEDIUM_OUTPUT_MAX_BYTES,
                    message: "Output is too large. Use --filter or --get to reduce output."
                });
            }
            else {
                logger.result(result);
            }
            return;
        }
        const { sizeBytes } = getJsonOutputSize(artifact);
        if (sizeBytes >= MEDIUM_OUTPUT_MAX_BYTES) {
            logger.result({
                kind: "oversized-output",
                apiName,
                artifactType: selection.artifactName,
                sizeBytes,
                maxBytes: MEDIUM_OUTPUT_MAX_BYTES,
                message: "Output is too large. Use `get-operation-artifact [--filter <expr>|--get <path>] <operationId>` to reduce output."
            });
        }
        else {
            logger.result(artifact);
        }
    }
    catch (error) {
        logger.error(`Failed to read artifact ${selection.artifactName}: ${toErrorMessage(error)}`);
        process.exitCode = 1;
    }
});
getOperationCmd.agentMeta = {
    name: "get-operation",
    category: "Navigation",
    usage: "openapi-skills get-operation|get-operation-artifact <operationId> --api <apiName> [--request] [--response] [--response-schema] [--get <path>] [--filter count|<index>|<range>|<path>=<value>]",
    description: "Return a stored operation artifact created by `openapi-skills request` as raw JSON. Run `request` for the same operationId first so the artifact exists. The first example shows that prerequisite request step. Select path first with --get, then use --filter to return an array count, item, slice, or path/value match. Use --response-schema first when the response shape is unknown. Exactly one of --request, --response, or --response-schema is required. New --filter modes only work when the selected target is an array. Alias: `get-operation-artifact`.",
    arguments: [
        { name: "operationId", type: "string", required: true, positional: true, description: "The operationId whose stored artifact should be returned." },
        { name: "api", type: "string", required: true, flag: true, description: "The API name as defined in .openapi-skills/config.json." },
        { name: "request", type: "flag", required: false, flag: true, description: "Return request artifact for the operation." },
        { name: "response", type: "flag", required: false, flag: true, description: "Return response artifact for the operation." },
        { name: "response-schema", type: "flag", required: false, flag: true, description: "Return response-schema artifact for the operation. Inspect this first when the response shape is unknown." },
        { name: "get", type: "string", required: false, flag: true, description: "Select a nested value by dot-notation path first. Inspect get-operation --response-schema first so the path matches the actual response shape." },
        { name: "filter", type: "string", required: false, flag: true, description: "Filter the selected value using count, index, range, or <path>=<value> syntax. Examples: --filter count, --filter 0, --filter 0:10, --filter status=sold. Select path first with --get, then filter or slice the selected value." }
    ],
    examples: [
        "openapi-skills request getPetById --api petstore --force",
        "openapi-skills get-operation getPetById --api petstore --request",
        "openapi-skills get-operation-artifact getPetById --api petstore --request",
        "openapi-skills get-operation getPetById --api petstore --response-schema",
        "openapi-skills get-operation-artifact getPetById --api petstore --response-schema",
        "openapi-skills get-operation getPetById --api petstore --response",
        "openapi-skills get-operation-artifact getPetById --api petstore --response",
        "openapi-skills get-operation getPetById --api petstore --response --get name",
        "openapi-skills get-operation getPetById --api petstore --response --get body --filter id=555",
        "openapi-skills get-operation getPetById --api petstore --response --filter id=5555",
        "openapi-skills get-operation getPetById --api petstore --response --filter count",
        "openapi-skills get-operation getPetById --api petstore --response --filter 0",
        "openapi-skills get-operation getPetById --api petstore --response --filter 0:10"
    ],
    returns: {
        type: "json",
        description: "Returns the selected artifact as raw JSON, or a nested value / filtered array when --get or --filter is supplied. When both are used, --get runs first and --filter applies to the narrowed result. Inspect --response-schema first when the response shape is unknown so --get and --filter can be applied in the right order. --filter can also return an array count, single item, or slice when the selected target is an array."
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
    .description("Make a live HTTP request for a specific endpoint, or prepare a multi-step request scenario without executing requests. Supports: --validate (validate only the response against the schema after the request is sent; it does not validate request bodies or guarantee a response exists), --force (regenerate request artifact; use it when you want the original schema-shaped template), --update-request (patch request artifact; only flattened object dot-notation keys are allowed), --header (add headers).")
    .requiredOption("--api <apiName>", "API name to use")
    .option("--validate", "Validate only the response against the schema after the request is sent. Does not validate the request body or guarantee a response exists.")
    .option("--force", "Force overwrite request artifact with default values. Use this when you want the original schema-shaped template; omit it if you want to keep previous request values.")
    .option("--update-request <json>", [
    "Update request artifact before making the request using a single-quoted JSON string that represents a flattened object with dot-notation keys.",
    "Nested JSON objects are supported (they will be flattened and issue a warning), but the top-level value must be a JSON object. Invalid JSON will cause the command to fail.",
    "To delete a field, set its value to \"__delete__\".",
    "Format (POSIX shells): --update-request '{\"field.path\":value,...}'",
    "Format (PowerShell): --update-request \"{\"field.path\":value,...}\"  (escape inner quotes as needed)",
    "  - Only flattened object dot-notation keys are recommended (e.g. 'items.0.name').",
    "Examples:",
    "   --update-request '{\"person.id\":\"2\"}'",
    "   --update-request '{\"items.0.name\":\"Alice\",\"items.1.value\":42}'",
    "   --update-request '{\"parameters.0\":\"__delete__\"}'",
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
    if (!(await guardApiName(apiName))) {
        return;
    }
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
    let requestJsonWarnings;
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
        const sanitizedOperationId = await getSanitizedOperationId(apiName, operationId);
        const requestJsonPath = getOperationArtifactPath(apiName, sanitizedOperationId, "request");
        if (options.force === true) {
            const config = await loadConfig();
            const configuredSchemaType = config.apis?.[apiName]?.schemaType;
            let isGraphQLSchema = configuredSchemaType === "graphql";
            if (!isGraphQLSchema && configuredSchemaType !== "openapi") {
                try {
                    const endpoints = await fs.readJson(getEndpointsPath(apiName));
                    isGraphQLSchema = Array.isArray(endpoints) && endpoints.some((endpoint) => typeof endpoint?.rootType === "string");
                }
                catch {
                    isGraphQLSchema = false;
                }
            }
            if (!isGraphQLSchema) {
                await ensureEndpointSchemaFile(apiName, operationId, sanitizedOperationId);
            }
            await prepareRequestTemplate(apiName, sanitizedOperationId, true);
        }
        else if (!(await fs.pathExists(requestJsonPath))) {
            logger.error("--update-request requires an existing request.json artifact. Use --force to regenerate the request template.");
            process.exitCode = 2;
            return;
        }
        const requestJson = await fs.readJson(requestJsonPath);
        const requestJsonKeys = collectRequestJsonPaths(requestJson);
        const updateKeys = collectUpdateRequestKeys(updates);
        const missingKeys = Array.from(updateKeys).filter(key => !requestJsonKeys.has(key));
        if (missingKeys.length > 0) {
            logger.error(`--update-request contains keys not present in request.json: ${missingKeys.join(", ")}.`);
            process.exitCode = 2;
            return;
        }
        if (options.force === true) {
            const typeWarnings = collectRequestUpdateTypeWarnings(requestJson, updates);
            if (typeWarnings.length > 0) {
                requestJsonWarnings = typeWarnings;
            }
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
            const result = await validateResponse(apiName, operationId, options.force, cliHeaders, requestJsonUpdates, requestJsonWarnings);
            const metadata = getRequestResponseMetadata(apiName, operationId);
            logger.result({
                kind: "validation-result",
                apiName,
                operationId,
                valid: result.valid,
                warnings: result.warnings ?? [],
                errors: result.errors ?? [],
                operationArtifactCount: metadata.fileCount,
                retrieveArtifacts: "Use `get-operation-artifact [--request|--response|--response-schema] <operationId>` to view this operation's artifacts."
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
            const { request, response, warnings } = await makeRequest(apiName, operationId, options.force, cliHeaders, requestJsonUpdates, requestJsonWarnings);
            await ensureResponseSchema(apiName, operationId);
            const metadata = getRequestResponseMetadata(apiName, operationId);
            logger.result({
                kind: "request-result",
                apiName,
                operationId,
                warnings: warnings ?? [],
                fileCount: metadata.fileCount,
                retrieveArtifacts: "Use `get-operation-artifact [--request|--response|--response-schema] <operationId>` to view this operation's artifacts."
            });
            process.exitCode = 0;
        }
        catch (error) {
            logger.result({
                kind: "request-result",
                apiName,
                operationId,
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
        "Make a live HTTP request for an endpoint, or prepare a multi-step request scenario without executing requests.",
        "When multiple operationIds are supplied, the command enters prepare-only mode and only refreshes request artifact templates for the scenario.",
        "Request and Response Artifacts created by the request command never update automatically.",
        "Each artifact reflects the endpoint or root field exactly as it was when the request ran.",
        "Artifacts stay unchanged until another request is executed for that same endpoint or root field.",
        "No other command updates or regenerates request and response artifacts.",
        "With --validate, validate only the response against the schema after the request is sent. It does not validate the request body or guarantee a response exists.",
        "With --force, regenerate request artifact from schema defaults. Use it with --update-request when you want the original schema-shaped template before patching, and skip it if you want to keep previous request values. Type mismatch warnings for --update-request are only checked when --force is used, because the regenerated template mirrors the schema.",
        "With --update-request, patch request artifact before sending using flattened dot-notation keys, such as user.profile.name or parameters.0.id. Nested JSON objects are accepted (they will be flattened and a warning emitted), but the provided value must be valid JSON. Invalid JSON will cause the command to fail. To delete a field, set its value to \"__delete__\" (for example, parameters.0). Use --force when you want to restore defaults and patch in the same run."
    ].join(" "),
    arguments: [
        { name: "operationId", type: "string[]", required: true, positional: true, description: "One or more operationIds to invoke. Multiple values switch the command into prepare-only mode for a multi-step scenario." },
        { name: "api", type: "string", required: true, flag: true, description: "The API name as defined in .openapi-skills/config.json." },
        { name: "validate", type: "flag", required: false, flag: true, description: "Validate only the response against the schema after the request is sent. Does not validate the request body or guarantee a response exists." },
        { name: "force", type: "flag", required: false, flag: true, description: "Force overwrite request artifact with default values. Use this when you want the original schema-shaped template; omit it if you want to keep previous request values." },
        { name: "update-request", type: "json", required: false, flag: true, description: "Patch request artifact before making the request. Only flattened object dot-notation keys are allowed. Set a field to \"__delete__\" to remove it. Use with --force to rebuild defaults first." },
        { name: "header", type: "json", required: false, flag: true, description: "Additional headers as a JSON string." }
    ],
    examples: [
        "openapi-skills request getPetById --api petstore",
        "openapi-skills request getPetById --api petstore --validate",
        "openapi-skills request getPetById --api petstore --force --update-request '{\"user.profile.name\":\"Ada\"}'",
        "openapi-skills request getPetById --api petstore --update-request '{\"user.profile.name\":\"Ada\"}'",
        "openapi-skills request getPetById --api petstore --update-request '{\"parameters.0.id\":1}'",
        "openapi-skills request getPetById --api petstore --update-request '{\"parameters.0\":\"__delete__\"}'",
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
    filesWritten: ["request artifact", "response artifact", "response-schema artifact (when response has JSON body)"]
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
    if (!(await guardApiName(apiName))) {
        return;
    }
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
    if (!(await guardApiName(apiName))) {
        return;
    }
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
            logger.warn("No APIs were generated yet. Run first: openapi-skills generate <openapi-source> [options]");
        }
    }
    catch (error) {
        logger.result({
            ok: false,
            error: {
                type: "ListApisError",
                message: "Failed to list APIs. Run `openapi-skills generate [options] [openapi-source]` to parse APIs first."
            }
        });
        logger.error("Error listing APIs: ${error instanceof Error ? error.message : String(error)}. Try running \`openapi-skills generate [options] [openapi-source]\` to parse APIs first.");
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