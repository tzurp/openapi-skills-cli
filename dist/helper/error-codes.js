export var ErrorCode;
(function (ErrorCode) {
    ErrorCode["UNKNOWN_API"] = "UNKNOWN_API";
    ErrorCode["MISSING_FILTER_ARGUMENT"] = "MISSING_FILTER_ARGUMENT";
    ErrorCode["INVALID_FILTER_SYNTAX"] = "INVALID_FILTER_SYNTAX";
    ErrorCode["SCHEMA_TYPE_MISMATCH"] = "SCHEMA_TYPE_MISMATCH";
    ErrorCode["INVALID_VARIABLE_SYNTAX"] = "INVALID_VARIABLE_SYNTAX";
    ErrorCode["INVALID_JSON_ARGUMENT"] = "INVALID_JSON_ARGUMENT";
    ErrorCode["SCHEMA_VALIDATION_FAILED"] = "SCHEMA_VALIDATION_FAILED";
    ErrorCode["INVALID_REQUEST_UPDATE"] = "INVALID_REQUEST_UPDATE";
    ErrorCode["INVALID_UPDATE_REQUEST_JSON"] = "INVALID_UPDATE_REQUEST_JSON";
    ErrorCode["MISSING_PARSED_API"] = "MISSING_PARSED_API";
    ErrorCode["NO_ENDPOINTS_FOUND"] = "NO_ENDPOINTS_FOUND";
    ErrorCode["NO_RESPONSE_SCHEMA"] = "NO_RESPONSE_SCHEMA";
    ErrorCode["REQUEST_TEMPLATE_STALE"] = "REQUEST_TEMPLATE_STALE";
    ErrorCode["OVERSIZED_OUTPUT"] = "OVERSIZED_OUTPUT";
    ErrorCode["API_PARSE_ERROR"] = "API_PARSE_ERROR";
    ErrorCode["REQUEST_FAILED"] = "REQUEST_FAILED";
    ErrorCode["VALIDATION_FAILED"] = "VALIDATION_FAILED";
    ErrorCode["CONFIG_ERROR"] = "CONFIG_ERROR";
})(ErrorCode || (ErrorCode = {}));
export const RemediationTemplates = {
    [ErrorCode.UNKNOWN_API]: {
        reason: "The API name is not registered in .openapi-skills/config.json.",
        nextCommandHint: "Run 'openapi-skills get-api-names' to list available APIs, then use the correct name.",
    },
    [ErrorCode.MISSING_PARSED_API]: {
        reason: "No APIs have been parsed yet. The workspace is empty.",
        nextCommandHint: "Run 'openapi-skills generate' with an OpenAPI or GraphQL source.",
    },
    [ErrorCode.NO_ENDPOINTS_FOUND]: {
        reason: "The API endpoint file does not exist. Run generate first.",
        nextCommandHint: "Run 'openapi-skills generate' to create endpoints.json.",
    },
    [ErrorCode.NO_RESPONSE_SCHEMA]: {
        reason: "The response schema artifact has not been created yet.",
        nextCommandHint: "Run 'openapi-skills request <operationId> --api <apiName>' to create the response-schema artifact.",
    },
    [ErrorCode.REQUEST_TEMPLATE_STALE]: {
        reason: "The request template does not exist for this operation.",
        nextCommandHint: "Run the command again with --force to regenerate the request template.",
    },
    [ErrorCode.SCHEMA_VALIDATION_FAILED]: {
        reason: "The provided OpenAPI or GraphQL schema is malformed.",
        nextCommandHint: "Fix the schema at its source and retry.",
    },
    [ErrorCode.INVALID_FILTER_SYNTAX]: {
        reason: "--filter requires the target to be an array.",
        nextCommandHint: "Use --response-schema first to inspect the response shape, then use --get to narrow the value before filtering.",
    },
    [ErrorCode.MISSING_FILTER_ARGUMENT]: {
        reason: "The list command requires at least one filter to avoid returning large, unbounded result sets.",
        nextCommandHint: "Add --path, --filter, --method, --root-type, or --index to narrow results.",
    },
    [ErrorCode.SCHEMA_TYPE_MISMATCH]: {
        reason: "The flag used is incompatible with this schema type.",
        nextCommandHint: "Use --path and --method for OpenAPI; use --root-type for GraphQL.",
    },
    [ErrorCode.INVALID_JSON_ARGUMENT]: {
        reason: "The provided JSON argument is malformed.",
        nextCommandHint: "Fix the JSON syntax and retry.",
    },
    [ErrorCode.INVALID_VARIABLE_SYNTAX]: {
        reason: "Variable syntax is invalid. Expected key=value format.",
        nextCommandHint: "Use --var key=value format.",
    },
    [ErrorCode.INVALID_UPDATE_REQUEST_JSON]: {
        reason: "The --update-request JSON could not be parsed.",
        nextCommandHint: "Fix the JSON syntax and retry.",
    },
    [ErrorCode.INVALID_REQUEST_UPDATE]: {
        reason: "The request keys specified do not exist in request.json.",
        nextCommandHint: "Use valid request.json keys. Inspect with 'openapi-skills get-operation <operationId> --api <apiName> --request' first.",
    },
    [ErrorCode.OVERSIZED_OUTPUT]: {
        reason: "The output is too large to display.",
        nextCommandHint: "Use --get or --filter to reduce output size.",
    },
    [ErrorCode.API_PARSE_ERROR]: {
        reason: "An error occurred while parsing the API schema.",
        nextCommandHint: "Review the error details and fix the schema at its source.",
    },
    [ErrorCode.REQUEST_FAILED]: {
        reason: "The HTTP request failed.",
        nextCommandHint: "Check the base URL, authentication headers, and network connectivity.",
    },
    [ErrorCode.VALIDATION_FAILED]: {
        reason: "The response does not match the expected schema.",
        nextCommandHint: "Verify that the API response matches the declared schema.",
    },
    [ErrorCode.CONFIG_ERROR]: {
        reason: "Failed to read or write configuration file.",
        nextCommandHint: "Check file permissions on .openapi-skills/config.json.",
    },
};
export const ErrorCategories = {
    [ErrorCode.UNKNOWN_API]: "usage",
    [ErrorCode.MISSING_FILTER_ARGUMENT]: "usage",
    [ErrorCode.INVALID_FILTER_SYNTAX]: "usage",
    [ErrorCode.SCHEMA_TYPE_MISMATCH]: "usage",
    [ErrorCode.INVALID_VARIABLE_SYNTAX]: "usage",
    [ErrorCode.INVALID_JSON_ARGUMENT]: "usage",
    [ErrorCode.SCHEMA_VALIDATION_FAILED]: "validation",
    [ErrorCode.INVALID_REQUEST_UPDATE]: "validation",
    [ErrorCode.INVALID_UPDATE_REQUEST_JSON]: "validation",
    [ErrorCode.MISSING_PARSED_API]: "state",
    [ErrorCode.NO_ENDPOINTS_FOUND]: "state",
    [ErrorCode.NO_RESPONSE_SCHEMA]: "state",
    [ErrorCode.REQUEST_TEMPLATE_STALE]: "state",
    [ErrorCode.OVERSIZED_OUTPUT]: "state",
    [ErrorCode.API_PARSE_ERROR]: "runtime",
    [ErrorCode.REQUEST_FAILED]: "runtime",
    [ErrorCode.VALIDATION_FAILED]: "runtime",
    [ErrorCode.CONFIG_ERROR]: "runtime",
};
//# sourceMappingURL=error-codes.js.map