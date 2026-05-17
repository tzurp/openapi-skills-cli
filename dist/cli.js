import { Command } from "commander";
import { parseSchemaSource, validateSchema } from "./parser.js";
import fs from "fs-extra";
import path from "path";
import { getOpenapiToSkillsDir, getProjectRoot, getEndpointsPath, getOperationArtifactPath } from "./helper/paths.js";
import { ensureConfig, updateConfig, listApis, getConfigValue, deleteApi, loadConfig } from "./index.js";
import { buildClientCodeSchema } from "./client-schema-builder.js";
import {} from "./helper/json-updater.js";
import { validateResponse, makeRequest, ensureResponseSchema, prepareRequestTemplate, collectRequestUpdateTypeWarnings, getSchemaType } from "./validate-response.js";
import { createRequire } from "module";
import { promptInstallLocation, installSkillBundle } from "./install-skill.js";
import { ensureEndpointSchemaFile } from "./parser.js";
import { logger, toErrorMessage } from "./helper/logger.js";
import { filterEndpoints, filterResolvedEndpoints, sliceEndpointsByIndex } from "./helper/endpoint-filter.js";
import { getSanitizedOperationId } from "./helper/endpoint-utils.js";
import { checkForUpdateOncePerTerminalSession } from "./helper/update-check.js";
import { getJsonOutputSize, MEDIUM_OUTPUT_MAX_BYTES } from "./helper/output-size.js";
import { promptDeleteConfirmation } from "./helper/prompt-delete.js";
import { collectRequestJsonPaths, collectUpdateRequestKeys, resolveSelectedArtifact } from "./helper/request-artifacts.js";
import { prepareMultiOperationRequests, getRequestResponseMetadata } from "./helper/request-preparation.js";
import { filterArray, getByPath } from "./helper/dotNotation.js";
import { parseGetOperationFilter } from "./helper/get-operation-filter.js";
import { buildError, buildSuccess } from "./helper/error-formatter.js";
import { ErrorCode } from "./helper/error-codes.js";
const require = createRequire(import.meta.url);
const pkg = require("../package.json");
const url = pkg.repository.url;
await checkForUpdateOncePerTerminalSession(pkg.version);
const openapiToSkillsDir = getOpenapiToSkillsDir();
const program = new Command();
const silentFlagRequested = process.argv.includes("--silent");
program.name("openapi-skills")
    .description("A command‑line tool for working with OpenAPI/Swagger and GraphQL specs. Use it to parse specs into artifacts, explore API endpoints and root fields, validate requests, generate typed client metadata, and teach AI agents how to operate the CLI and write API tests and client code.")
    .version(pkg.version);
async function guardApiName(apiName) {
    const apiNames = await listApis().catch(() => []);
    if (apiNames.includes(apiName)) {
        return true;
    }
    logger.result(buildError(ErrorCode.UNKNOWN_API, {
        summary: `API '${apiName}' is not installed.`,
        message: `No API named '${apiName}' was found. Run 'openapi-skills get-api-names' to list installed APIs, or run 'openapi-skills generate <openapi-source>' first.`,
        context: { api_name: apiName },
        nextCommand: "openapi-skills get-api-names",
    }));
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
Project: ${url}
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
        logger.result(buildError(ErrorCode.CONFIG_ERROR, {
            summary: "Failed to install skill bundle.",
            message: err instanceof Error ? err.message : String(err),
            context: { install_path: installPath },
            nextCommand: "openapi-skills install --skills",
        }));
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
                logger.result(buildSuccess({
                    valid: true,
                    schemaSource: options.validate,
                    message: "Schema is valid",
                }, { kind: "schema-validation" }));
                process.exitCode = 0;
            }
            catch (error) {
                logger.result(buildError(ErrorCode.SCHEMA_VALIDATION_FAILED, {
                    summary: "OpenAPI or GraphQL schema is invalid.",
                    message: `Schema validation failed: ${toErrorMessage(error)}`,
                    context: { schema_source: options.validate },
                    nextCommand: `openapi-skills generate ${options.validate}`,
                }));
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
            logger.result(buildSuccess({
                apiName,
                openapiSource,
                warning: warningMessage,
            }, { kind: "generate-warning" }));
        }
        logger.result(buildSuccess({
            apiName,
            openapiSource,
            fileCount: 3,
        }, { kind: "generate-result" }));
        process.exitCode = 0;
    }
    catch (error) {
        logger.result(buildError(options.validate ? ErrorCode.SCHEMA_VALIDATION_FAILED : ErrorCode.API_PARSE_ERROR, {
            summary: options.validate ? "OpenAPI or GraphQL schema is invalid." : "Failed to parse the provided schema.",
            message: toErrorMessage(error),
            context: { openapi_source: openapiSource },
            nextCommand: options.validate ? `openapi-skills generate ${options.validate}` : `openapi-skills generate ${openapiSource ?? "<openapi-source>"}`,
        }));
        process.exitCode = 1;
    }
});
generateCmd.agentMeta = {
    name: "generate",
    category: "Generation",
    usage: "openapi-skills generate [openapi-source] [--validate <schema>] [--base-url <url>] [--dereference] [--no-progress] [--rename <newName>]",
    description: "Parse a source file or URL and generate the API artifacts used by the rest of the CLI. Use --validate to check a schema and exit, --base-url to set the API base URL, --dereference when full dereferencing is appropriate, --rename to override the generated API name, and --no-progress to suppress progress output.",
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
    .description("List summarized operation objects for the specified API as JSON. Supports --filter, --resolved/--dereferenced, --index slicing, and --count for operation totals. Also supports OpenAPI‑only options (--path, --method) and the GraphQL‑only option (--root-type). At least one filter is required unless --index : is used intentionally. GraphQL APIs reject --method and --path, and OpenAPI APIs reject --root-type.")
    .requiredOption("--api <apiName>", "API name to use")
    .option("--count", "Return the number of operations after applying any list filters and index slicing. With no filters, returns the total operation count.")
    .option("--resolved, --dereferenced", "Show only operations that already have generated schema details saved.")
    .option("--path <path>", [
    "Filter operations by path structure. Repeatable; multiple values are ANDed.",
    "Supports:",
    "  - Path prefix: /users (matches operations whose path begins with /users)",
    "  - Parameter detection: :param (matches operations with any {param} in the path)",
    "  - Segment matching: 'store order' (matches operations whose path contains BOTH 'store' AND 'order' as segments, in any order)",
    "  - OR within a clause: 'store|shop' (matches operations whose path contains EITHER 'store' OR 'shop')",
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
    .option("--filter <filterPattern>", "Filter operations by any of their searchable properties. Supports AND/OR (use spaces for AND, | for OR), e.g. --filter 'create account|register user'.")
    .option("--method <method>", "Filter operations by HTTP method (GET, POST, etc). Use this for OpenAPI operations.")
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
            logger.result(buildError(ErrorCode.SCHEMA_TYPE_MISMATCH, {
                summary: "--method and --path are only valid for OpenAPI APIs.",
                message: "This API is GraphQL. Use --root-type with --filter instead.",
                context: { api_name: apiName, schema_type: schemaType },
                nextCommand: `openapi-skills list --api ${apiName} --root-type query`,
            }));
            process.exitCode = 2;
            return;
        }
        if (schemaType === "openapi" && typeof options.rootType === "string") {
            logger.result(buildError(ErrorCode.SCHEMA_TYPE_MISMATCH, {
                summary: "--root-type is only valid for GraphQL APIs.",
                message: "This API is OpenAPI. Use --method and --path or --filter instead.",
                context: { api_name: apiName, schema_type: schemaType },
                nextCommand: `openapi-skills list --api ${apiName} --method GET`,
            }));
            process.exitCode = 2;
            return;
        }
        if (!options.count && !hasFilter) {
            logger.result(buildError(ErrorCode.MISSING_FILTER_ARGUMENT, {
                summary: "No filter provided. Use --path, --filter, --method, --root-type, or --index.",
                message: "The list command requires at least one filter to avoid returning large, unbounded result sets.",
                context: { api_name: apiName },
                nextCommand: `openapi-skills list --api ${apiName} --index :`,
                severity: "warning",
            }));
            process.exitCode = 0;
            return;
        }
        if (fs.existsSync(endpointsPath) === false) {
            if (options.count) {
                logger.result(buildSuccess({
                    count: 0,
                    message: `No endpoints.json found for API "${apiName}".`,
                }, { kind: "endpoint-count" }));
                return;
            }
            logger.result(buildError(ErrorCode.NO_ENDPOINTS_FOUND, {
                summary: `No endpoints.json found for API "${apiName}".`,
                message: `The API has not been parsed yet. Run 'openapi-skills generate' to create it.`,
                context: { api_name: apiName },
                nextCommand: `openapi-skills generate <openapi-source> --rename ${apiName}`,
                reason: "The API artifacts have not been generated.",
            }));
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
            logger.result(buildSuccess({
                count: filtered.length,
                apiName,
            }, { kind: "endpoint-count" }));
            return;
        }
        if (filtered.length === 0) {
            logger.result(buildSuccess({
                apiName,
                items: [],
            }, { kind: "endpoint-list" }));
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
        logger.result(buildSuccess({
            apiName,
            items: filtered,
        }, { kind: "endpoint-list" }));
    }
    catch (error) {
        logger.result(buildError(ErrorCode.API_PARSE_ERROR, {
            summary: "Error listing endpoints.",
            message: toErrorMessage(error),
            context: { api_name: apiName },
        }));
        process.exitCode = 1;
    }
});
listCmd.agentMeta = {
    name: "list",
    category: "Navigation",
    usage: "openapi-skills list --api <apiName> [--count] [--resolved|--dereferenced] [--path <path>]... [--filter <pattern>] [--method <method>] [--root-type <rootType>] [--index <range>]",
    description: [
        "List operation summaries for a parsed API as JSON.",
        "At least one filter is required. --index is treated as a filter input, so the command can run when only a slice is requested.",
        "Use --count to return the number of operations after filtering and slicing, or --resolved to show only operations that already have generated schema details saved.",
        "Filter usage differs by schema type: use --method and --path for OpenAPI operations, use --root-type for GraphQL root fields, and use --filter and --index with either schema. Filtering is case-insensitive and supports:",
        "- Path prefix: --path '/users' (matches operations whose path begins with the prefix)",
        "- Parameter detection: --path :param (matches operations that contain at least one '{...}' path placeholder)",
        "- Segment matching: --path 'store order' (matches endpoints whose path contains both segments)",
        "- OR within a single path clause: --path 'store|shop' (matches either segment)",
        "- Multiple path flags are ANDed: --path /store --path order",
        "- Simple substring filtering: --filter 'user account' (matches operations containing both 'user' and 'account' in any field, including GraphQL name/rootType fields)",
        "- OR filtering: --filter 'create|register|signup' (matches any operation containing any of the words)",
        "- Combined AND+OR: --filter 'create account|register user' (matches operations containing both 'create' and 'account', OR both 'register' and 'user')",
        "- Path substring search: --filter '/users' (matches operations whose path contains the substring)",
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
        "Use --path for path-aware matching. Use --filter for substring matching across path, operationId/name, rootType, summary, or description.",
        "If no operations match, outputs [] and prints a message to stderr."
    ].join("\n"),
    arguments: [
        { name: "api", type: "string", required: true, flag: true, description: "API name to use." },
        { name: "count", type: "flag", required: false, flag: true, description: "Return the number of operations after filtering and slicing." },
        { name: "resolved", type: "flag", required: false, flag: true, description: "Show only operations that already have generated schema details saved. Alias: --dereferenced." },
        { name: "path", type: "string[]", required: false, flag: true, description: "Filter operations by path structure." },
        { name: "filter", type: "string", required: false, flag: true, description: "Filter operations by keywords, operationId/name, rootType, path, summary, or description." },
        { name: "method", type: "string", required: false, flag: true, description: "Filter OpenAPI operations by HTTP method." },
        { name: "rootType", type: "string", required: false, flag: true, description: "Filter GraphQL operations by root type (query, mutation, or subscription)." },
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
        description: "Returns filtered operation summaries as JSON, or a count object when --count is used. When no filters are provided, returns a structured warning object."
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
    .description("Return structured metadata for client code generation for a specific operation. Use --force to overwrite the cached <operationId> artifact file before reading it.")
    .action(async (operationId, options) => {
    const apiName = options.api;
    if (!(await guardApiName(apiName))) {
        return;
    }
    try {
        const sanitizedOperationId = await getSanitizedOperationId(apiName, operationId);
        const schema = await buildClientCodeSchema(apiName, operationId, sanitizedOperationId, options.force === true);
        logger.result(buildSuccess(schema, { kind: "client-schema" }));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.result(buildError(ErrorCode.API_PARSE_ERROR, {
            summary: "Error generating client code metadata.",
            message,
            context: { api_name: apiName, operation_id: operationId },
        }));
        process.exitCode = 1;
    }
});
genClientSchemaCmd.agentMeta = {
    name: "generate-client-schema",
    category: "Code Generation",
    usage: "openapi-skills generate-client-schema <operationId> --api <apiName> [--force]",
    description: "Print structured metadata optimized for client code generation as pretty-printed JSON. Returns `response: null` for operations with no JSON response body, in which case the generated client should return `Promise<void>`. The cached artifact is reused unless --force is provided.",
    arguments: [
        { name: "operationId", type: "string", required: true, positional: true, description: "The operationId of the operation to inspect." },
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
    .description("describe → fallback for generate-client-schema. Use generate-client-schema first. Prints the complete raw schema for a specific operation as JSON, including all parameters, request body, and all response codes. The cached <operationId> artifact file is reused unless --force is provided, which overwrites the cached schema from the bundled API document before output.")
    .action(async (operationId, options) => {
    const apiName = options.api;
    if (!(await guardApiName(apiName))) {
        return;
    }
    try {
        const sanitizedOperationId = await getSanitizedOperationId(apiName, operationId);
        const schema = await ensureEndpointSchemaFile(apiName, operationId, sanitizedOperationId, options.force === true);
        logger.result(buildSuccess({
            operationId,
            warnings: ["describe → fallback for generate-client-schema. Use openapi-skills generate-client-schema first for client code generation."],
            schema,
        }, { kind: "describe-result" }));
        return;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.result(buildError(ErrorCode.API_PARSE_ERROR, {
            summary: "Error describing operation.",
            message,
            context: { api_name: apiName, operation_id: operationId },
        }));
        process.exitCode = 1;
        return;
    }
});
describeCmd.agentMeta = {
    name: "describe",
    category: "Navigation",
    usage: "openapi-skills describe <operationId> --api <apiName> [--force]",
    description: [
        "Fallback for generate-client-schema. Prints the complete raw schema for a specific operation as JSON, including all parameters, request body, and response codes. The cached artifact is reused unless --force is provided.",
        "",
        "**Agents MUST use `generate-client-schema` for client code generation. Use `describe` only when you need full raw schema detail beyond what `generate-client-schema` provides.**"
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
        logger.result(buildError(ErrorCode.INVALID_REQUEST_UPDATE, {
            summary: "Invalid operation artifact selection.",
            message: selection.error ?? "Invalid operation artifact selection.",
            context: { api_name: apiName, operation_id: operationId },
            nextCommand: `openapi-skills get-operation ${operationId} --api ${apiName} --request`,
        }));
        process.exitCode = 1;
        return;
    }
    const artifactPath = getOperationArtifactPath(apiName, sanitizedOperationId, selection.artifactName);
    if (!(await fs.pathExists(artifactPath))) {
        if (selection.artifactName === "response-schema") {
            logger.result(buildError(ErrorCode.NO_RESPONSE_SCHEMA, {
                summary: "No response schema artifact exists for this operation.",
                message: "The response schema has not been created yet.",
                context: { api_name: apiName, operation_id: operationId, artifact_type: "response-schema" },
                nextCommand: `openapi-skills request ${operationId} --api ${apiName}`,
                reason: "Make a request first to generate the response-schema artifact.",
            }));
            process.exitCode = 1;
            return;
        }
        logger.result(buildError(ErrorCode.REQUEST_TEMPLATE_STALE, {
            summary: `Artifact '${selection.artifactName}' is missing for this operation.`,
            message: `The '${selection.artifactName}' artifact does not exist yet.`,
            context: { api_name: apiName, operation_id: operationId, artifact_type: selection.artifactName },
            nextCommand: `openapi-skills request ${operationId} --api ${apiName} --force`,
        }));
        process.exitCode = 1;
        return;
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
                logger.result(buildError(ErrorCode.OVERSIZED_OUTPUT, {
                    summary: "Output is too large to display.",
                    message: `The selected value is ${sizeBytes} bytes, exceeding the limit of ${MEDIUM_OUTPUT_MAX_BYTES} bytes.`,
                    context: { api_name: apiName, operation_id: operationId, artifact_type: selection.artifactName, size_bytes: sizeBytes },
                    nextCommand: `openapi-skills get-operation ${operationId} --api ${apiName} --${selection.artifactName} --get ${getPath} --filter count`,
                }));
            }
            else {
                logger.result(buildSuccess({
                    apiName,
                    value: selectedValue,
                }, { kind: "artifact-value" }));
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
                if (!Array.isArray(artifactToFilter)) {
                    if (arrayFields.length === 1) {
                        artifactToFilter = arrayFields[0];
                    }
                    else {
                        logger.result(buildError(ErrorCode.INVALID_FILTER_SYNTAX, {
                            summary: "--filter requires the target to be an array.",
                            message: `The selected value is not an array and contains no single array field to unwrap.`,
                            context: { api_name: apiName, operation_id: operationId, artifact_type: selection.artifactName, filter: filterExpr, selected_path: hasGet ? getPath : undefined },
                            nextCommand: `openapi-skills get-operation ${operationId} --api ${apiName} --${selection.artifactName} --response-schema`,
                        }));
                        process.exitCode = 1;
                        return;
                    }
                }
                if (!Array.isArray(artifactToFilter)) {
                    logger.result(buildError(ErrorCode.INVALID_FILTER_SYNTAX, {
                        summary: "--filter requires the target to be an array.",
                        message: `The selected value is not an array.`,
                        context: { api_name: apiName, operation_id: operationId, artifact_type: selection.artifactName, filter: filterExpr, selected_path: hasGet ? getPath : undefined },
                        nextCommand: `openapi-skills get-operation ${operationId} --api ${apiName} --${selection.artifactName}`,
                    }));
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
                    logger.result(buildError(ErrorCode.INVALID_FILTER_SYNTAX, {
                        summary: "--filter requires the --get result to be an array.",
                        message: `The value at path '${getPath}' is not an array.`,
                        context: { api_name: apiName, operation_id: operationId, artifact_type: selection.artifactName, filter: filterExpr, selected_path: getPath },
                        nextCommand: `openapi-skills get-operation ${operationId} --api ${apiName} --${selection.artifactName} --response-schema`,
                    }));
                    process.exitCode = 1;
                    return;
                }
                if (!Array.isArray(artifactToFilter)) {
                    const { sizeBytes } = getJsonOutputSize(artifactToFilter);
                    if (sizeBytes >= MEDIUM_OUTPUT_MAX_BYTES) {
                        logger.result(buildError(ErrorCode.OVERSIZED_OUTPUT, {
                            summary: "Output is too large to display.",
                            message: `The selected value is ${sizeBytes} bytes, exceeding the limit of ${MEDIUM_OUTPUT_MAX_BYTES} bytes.`,
                            context: { api_name: apiName, operation_id: operationId, artifact_type: selection.artifactName, size_bytes: sizeBytes },
                            nextCommand: `openapi-skills get-operation ${operationId} --api ${apiName} --${selection.artifactName} --filter count`,
                        }));
                    }
                    else {
                        logger.result(buildSuccess({
                            apiName,
                            value: artifactToFilter,
                        }, { kind: "artifact-value" }));
                    }
                    return;
                }
                result = filterArray(artifactToFilter, filterPath, expectedValue);
            }
            else {
                logger.result(buildError(ErrorCode.INVALID_FILTER_SYNTAX, {
                    summary: "Invalid --filter syntax.",
                    message: "--filter must use count, index, range, or <path>=<value> syntax.",
                    context: { api_name: apiName, operation_id: operationId, artifact_type: selection.artifactName, filter: filterExpr },
                    nextCommand: `openapi-skills get-operation ${operationId} --api ${apiName} --${selection.artifactName} --filter 0`,
                }));
                process.exitCode = 1;
                return;
            }
            const { sizeBytes } = getJsonOutputSize(result);
            if (sizeBytes >= MEDIUM_OUTPUT_MAX_BYTES) {
                logger.result(buildError(ErrorCode.OVERSIZED_OUTPUT, {
                    summary: "Output is too large to display.",
                    message: `The filtered result is ${sizeBytes} bytes, exceeding the limit of ${MEDIUM_OUTPUT_MAX_BYTES} bytes.`,
                    context: { api_name: apiName, operation_id: operationId, artifact_type: selection.artifactName, size_bytes: sizeBytes },
                    nextCommand: `openapi-skills get-operation ${operationId} --api ${apiName} --${selection.artifactName} --filter count`,
                }));
            }
            else {
                logger.result(buildSuccess({
                    apiName,
                    value: result,
                }, { kind: "artifact-value" }));
            }
            return;
        }
        const { sizeBytes } = getJsonOutputSize(artifact);
        if (sizeBytes >= MEDIUM_OUTPUT_MAX_BYTES) {
            logger.result(buildError(ErrorCode.OVERSIZED_OUTPUT, {
                summary: "Output is too large to display.",
                message: `The artifact is ${sizeBytes} bytes, exceeding the limit of ${MEDIUM_OUTPUT_MAX_BYTES} bytes.`,
                context: { api_name: apiName, operation_id: operationId, artifact_type: selection.artifactName, size_bytes: sizeBytes },
                nextCommand: `openapi-skills get-operation ${operationId} --api ${apiName} --${selection.artifactName} --get <path> --filter count`,
            }));
        }
        else {
            logger.result(buildSuccess({
                apiName,
                operationId,
                artifact,
            }, { kind: "artifact" }));
        }
    }
    catch (error) {
        logger.result(buildError(ErrorCode.API_PARSE_ERROR, {
            summary: `Failed to read artifact '${selection.artifactName}'.`,
            message: toErrorMessage(error),
            context: { api_name: apiName, operation_id: operationId, artifact_type: selection.artifactName },
        }));
        process.exitCode = 1;
    }
});
getOperationCmd.agentMeta = {
    name: "get-operation",
    category: "Navigation",
    usage: "openapi-skills get-operation|get-operation-artifact <operationId> --api <apiName> [--request] [--response] [--response-schema] [--get <path>] [--filter count|<index>|<range>|<path>=<value>]",
    description: "Return a stored operation artifact created by `openapi-skills request` as raw JSON. Run `request` first so the artifact exists. Use --get to select a nested value, then --filter to count, slice, or match values. Use --response-schema first when the response shape is unknown. Exactly one of --request, --response, or --response-schema is required. Alias: `get-operation-artifact`.",
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
    .description("Make a live HTTP request for a specific operation, or prepare a multi-step request scenario without executing requests. Supports: --validate (validate only the response against the schema after the request is sent; it does not validate request bodies or guarantee a response exists), --force (regenerate request artifact; use it when you want the original schema-shaped template), --update-request (patch request artifact; only flattened object dot-notation keys are allowed), --header (add headers).")
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
            logger.result(buildSuccess({
                summary: summaryText,
                operationIds,
                apiName,
            }, { kind: "request-prepare" }));
            process.exitCode = 0;
        }
        catch (error) {
            const message = toErrorMessage(error);
            logger.result(buildError(ErrorCode.API_PARSE_ERROR, {
                summary: "Failed to prepare multi-operation request scenario.",
                message,
                context: { api_name: apiName, operation_ids: operationIds },
            }));
            process.exitCode = 1;
        }
        return;
    }
    const operationId = operationIds[0];
    if (!operationId) {
        logger.result(buildError(ErrorCode.INVALID_REQUEST_UPDATE, {
            summary: "An operationId is required.",
            message: "Provide at least one operationId to invoke.",
            context: { api_name: apiName },
            nextCommand: `openapi-skills request <operationId> --api ${apiName}`,
        }));
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
            logger.result(buildError(ErrorCode.INVALID_UPDATE_REQUEST_JSON, {
                summary: "--update-request JSON is malformed.",
                message,
                context: { api_name: apiName, operation_id: operationId, update_request: options.updateRequest },
                nextCommand: `openapi-skills request ${operationId} --api ${apiName} --update-request '{\"field.path\":\"value\"}'`,
            }));
            process.exitCode = 2;
            return;
        }
        if (typeof updates !== "object" || Array.isArray(updates) || !updates || Object.keys(updates).length === 0) {
            logger.result(buildError(ErrorCode.INVALID_REQUEST_UPDATE, {
                summary: "--update-request must be a non-empty JSON object.",
                message: "Use flattened dot-notation keys and provide at least one update.",
                context: { api_name: apiName, operation_id: operationId, update_request: options.updateRequest },
                nextCommand: `openapi-skills request ${operationId} --api ${apiName} --update-request '{\"field.path\":\"value\"}'`,
            }));
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
            logger.result(buildError(ErrorCode.REQUEST_TEMPLATE_STALE, {
                summary: "request.json does not exist for this operation.",
                message: "--update-request requires an existing request.json artifact. Use --force to regenerate the request template.",
                context: { api_name: apiName, operation_id: operationId, artifact_type: "request" },
                nextCommand: `openapi-skills request ${operationId} --api ${apiName} --force --update-request '{\"field.path\":\"value\"}'`,
            }));
            process.exitCode = 2;
            return;
        }
        const requestJson = await fs.readJson(requestJsonPath);
        const requestJsonKeys = collectRequestJsonPaths(requestJson);
        const updateKeys = collectUpdateRequestKeys(updates);
        const missingKeys = Array.from(updateKeys).filter(key => !requestJsonKeys.has(key));
        if (missingKeys.length > 0) {
            logger.result(buildError(ErrorCode.INVALID_REQUEST_UPDATE, {
                summary: "--update-request contains keys not present in request.json.",
                message: `The following keys are missing from request.json: ${missingKeys.join(", ")}.`,
                context: { api_name: apiName, operation_id: operationId, update_request: options.updateRequest, missing_keys: missingKeys },
                nextCommand: `openapi-skills request ${operationId} --api ${apiName} --force`,
            }));
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
            logger.result(buildError(ErrorCode.INVALID_JSON_ARGUMENT, {
                summary: "--header JSON is malformed.",
                message,
                context: { header: options.header },
                nextCommand: `openapi-skills request ${operationId} --api ${apiName} --header '{"Header-Name":"value"}'`,
            }));
            process.exitCode = 2;
            return;
        }
    }
    if (options.validate) {
        try {
            const result = await validateResponse(apiName, operationId, options.force, cliHeaders, requestJsonUpdates, requestJsonWarnings);
            const metadata = getRequestResponseMetadata(apiName, operationId);
            if (!result.valid) {
                logger.result(buildError(ErrorCode.VALIDATION_FAILED, {
                    summary: "Response validation failed.",
                    message: (result.errors ?? []).join("; ") || "The response did not match the expected schema.",
                    context: {
                        api_name: apiName,
                        operation_id: operationId,
                        validation_warnings: result.warnings ?? [],
                        validation_errors: result.errors ?? [],
                        operation_artifact_count: metadata.fileCount,
                    },
                    nextCommand: `openapi-skills request ${operationId} --api ${apiName} --validate`,
                }));
                process.exitCode = 1;
                return;
            }
            logger.result(buildSuccess({
                apiName,
                operationId,
                valid: result.valid,
                warnings: result.warnings ?? [],
                errors: result.errors ?? [],
                operationArtifactCount: metadata.fileCount,
                retrieveArtifacts: "Use `get-operation-artifact [--request|--response|--response-schema] <operationId>` to view this operation's artifacts."
            }, { kind: "validation-result" }));
            process.exitCode = 0;
        }
        catch (error) {
            logger.result(buildError(ErrorCode.VALIDATION_FAILED, {
                summary: "Validation failed.",
                message: toErrorMessage(error),
                context: { api_name: apiName, operation_id: operationId },
                nextCommand: `openapi-skills request ${operationId} --api ${apiName} --validate`,
            }));
            process.exitCode = 2;
            return;
        }
    }
    else {
        try {
            const { request, response, warnings } = await makeRequest(apiName, operationId, options.force, cliHeaders, requestJsonUpdates, requestJsonWarnings);
            await ensureResponseSchema(apiName, operationId);
            const metadata = getRequestResponseMetadata(apiName, operationId);
            logger.result(buildSuccess({
                apiName,
                operationId,
                warnings: warnings ?? [],
                fileCount: metadata.fileCount,
                retrieveArtifacts: "Use `get-operation-artifact [--request|--response|--response-schema] <operationId>` to view this operation's artifacts."
            }, { kind: "request-result" }));
            process.exitCode = 0;
        }
        catch (error) {
            logger.result(buildError(ErrorCode.REQUEST_FAILED, {
                summary: "Request failed.",
                message: toErrorMessage(error),
                context: { api_name: apiName, operation_id: operationId },
                nextCommand: `openapi-skills request ${operationId} --api ${apiName}`,
            }));
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
        "Make a live HTTP request for an operation, or prepare a multi-step request scenario without executing requests.",
        "When multiple operationIds are supplied, the command enters prepare-only mode and refreshes request artifact templates for the scenario.",
        "With --validate, validate only the response against the schema after the request is sent.",
        "With --force, regenerate the request artifact from schema defaults.",
        "With --update-request, patch the request artifact using flattened dot-notation keys. Nested JSON objects are accepted, but the provided value must be valid JSON. Set a field to \"__delete__\" to remove it."
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
            logger.result(buildError(ErrorCode.INVALID_JSON_ARGUMENT, {
                summary: "--auth JSON is malformed.",
                message: "Invalid --auth JSON. Example: '{\"Authorization\":\"Bearer abc\"}'",
                context: { api_name: apiName, auth: options.auth ?? null },
                nextCommand: `openapi-skills set-env --api ${apiName} --auth '{\"Authorization\":\"Bearer abc\"}'`,
            }));
            process.exitCode = 1;
            return;
        }
    }
    const rawVars = options.var ? (Array.isArray(options.var) ? options.var : [options.var]) : [];
    const vars = {};
    for (const entry of rawVars) {
        const separatorIndex = entry.indexOf("=");
        if (separatorIndex <= 0) {
            logger.result(buildError(ErrorCode.INVALID_VARIABLE_SYNTAX, {
                summary: "Invalid --var syntax.",
                message: `Invalid --var value "${entry}". Use key=value.`,
                context: { api_name: apiName, variable: entry },
                nextCommand: `openapi-skills set-env --api ${apiName} --var userId=123`,
            }));
            process.exitCode = 1;
            return;
        }
        const key = entry.slice(0, separatorIndex).trim();
        const value = entry.slice(separatorIndex + 1);
        if (!key) {
            logger.result(buildError(ErrorCode.INVALID_VARIABLE_SYNTAX, {
                summary: "Invalid --var syntax.",
                message: `Invalid --var value "${entry}". Use key=value.`,
                context: { api_name: apiName, variable: entry },
                nextCommand: `openapi-skills set-env --api ${apiName} --var userId=123`,
            }));
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
        logger.result(buildSuccess({
            apiName,
            baseUrl,
            hasAuth: auth !== undefined,
            varCount: Object.keys(vars).length,
        }, { kind: "set-env-result" }));
    }
    catch (error) {
        logger.result(buildError(ErrorCode.CONFIG_ERROR, {
            summary: "Failed to update API environment.",
            message: toErrorMessage(error),
            context: { api_name: apiName, base_url: baseUrl ?? null, var_count: Object.keys(vars).length },
            nextCommand: `openapi-skills set-env --api ${apiName}`,
        }));
        process.exitCode = 1;
    }
});
setEnvCmd.agentMeta = {
    name: "set-env",
    category: "Configuration",
    usage: "openapi-skills set-env --api <apiName> [--base-url <url>] [--auth <json>] [--var key=value]",
    description: "Set or update the runtime environment for a parsed API. Persists baseUrl, auth headers, and named vars in config.json.",
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
        const resultPayload = { apiName };
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
        logger.result(buildSuccess(resultPayload, { kind: "get-env-result" }));
        process.exitCode = 0;
    }
    catch (err) {
        logger.result(buildError(ErrorCode.CONFIG_ERROR, {
            summary: "Failed to read API environment.",
            message: err instanceof Error ? err.message : String(err),
            context: { api_name: apiName },
            nextCommand: `openapi-skills get-env --api ${apiName}`,
        }));
        process.exitCode = 1;
    }
});
getEnvCmd.agentMeta = {
    name: "get-env",
    category: "Configuration",
    usage: "openapi-skills get-env --api <apiName>",
    description: "Read environment configuration for an API. Returns all values by default, or only a specific field when a flag is provided.",
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
        logger.result(buildSuccess({
            apiNames,
        }, { kind: "api-list" }));
        if (!apiNames || apiNames.length === 0) {
            logger.warn("No APIs were generated yet. Run first: openapi-skills generate <openapi-source> [options]");
        }
    }
    catch (error) {
        logger.result(buildError(ErrorCode.CONFIG_ERROR, {
            summary: "Failed to list APIs.",
            message: "Run `openapi-skills generate [options] [openapi-source]` to parse APIs first.",
            context: {},
            nextCommand: "openapi-skills generate <openapi-source>",
        }));
        process.exitCode = 1;
    }
});
getApiNamesCmd.agentMeta = {
    name: "get-api-names",
    category: "Navigation",
    usage: "openapi-skills get-api-names",
    description: "List all available parsed API names in the project. Output is always JSON: { kind: 'api-list', apiNames: [<apiName>, ...] }.",
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
            logger.result(buildError(ErrorCode.UNKNOWN_API, {
                summary: `API '${targetApiName}' is not installed.`,
                message: `API '${targetApiName}' is not installed.`,
                context: { api_name: targetApiName },
                nextCommand: "openapi-skills get-api-names",
            }));
            process.exitCode = 1;
            return;
        }
        const confirmed = options?.yes === true ? true : await promptDeleteConfirmation(targetApiName);
        if (!confirmed) {
            logger.result(buildSuccess({ cancelled: true, apiName: targetApiName }, { kind: "remove-api-result" }));
            process.exitCode = 0;
            return;
        }
        const result = await deleteApi(targetApiName);
        if (result.ok) {
            logger.result(buildSuccess({
                removedApi: result.data.removedApi,
                message: result.message,
            }, { kind: "remove-api-result" }));
            process.exitCode = 0;
            return;
        }
        const errorCode = /config/i.test(result.error.message)
            ? ErrorCode.CONFIG_ERROR
            : result.error.type === "ApiNotFound"
                ? ErrorCode.UNKNOWN_API
                : ErrorCode.REQUEST_FAILED;
        logger.result(buildError(errorCode, {
            summary: `Remove API error for ${targetApiName}.`,
            message: result.error.message,
            context: { api_name: targetApiName },
            nextCommand: errorCode === ErrorCode.UNKNOWN_API ? "openapi-skills get-api-names" : "None",
        }));
        process.exitCode = 1;
        return;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.result(buildError(/config/i.test(message) ? ErrorCode.CONFIG_ERROR : ErrorCode.REQUEST_FAILED, {
            summary: `Remove API error for ${targetApiName}.`,
            message,
            context: { api_name: targetApiName },
            nextCommand: /config/i.test(message) ? "None" : `openapi-skills remove-api ${targetApiName} --yes`,
        }));
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
export { program };
program.parse(process.argv);
//# sourceMappingURL=cli.js.map