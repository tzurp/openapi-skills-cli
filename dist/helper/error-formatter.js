import { ErrorCode, ErrorCategories, RemediationTemplates } from "./error-codes.js";
export function buildError(code, options) {
    const category = ErrorCategories[code];
    const template = RemediationTemplates[code];
    const nextCommand = options.nextCommand ?? "None";
    const reason = options.reason ?? template?.reason ?? "Unable to remediate automatically.";
    const severity = options.severity ?? "error";
    return {
        ok: false,
        error: {
            code,
            category,
            severity,
            summary: options.summary,
            message: options.message,
            remediation: {
                required: true,
                next_command: nextCommand,
                reason,
            },
            context: options.context ?? {},
        },
    };
}
export function buildSuccess(data, options) {
    const response = {
        ok: true,
        data,
    };
    if (options?.kind !== undefined) {
        response.kind = options.kind;
    }
    return response;
}
export function successResult(kind, payload) {
    return {
        ok: true,
        kind,
        data: payload,
    };
}
export function successList(items) {
    return items;
}
export function remediateUnknownApi(apiName) {
    return {
        required: true,
        next_command: "openapi-skills get-api-names",
        reason: `API '${apiName}' is not registered. List all registered APIs and use a valid name.`,
    };
}
export function remediateMissingParsedApi(source) {
    const cmd = source
        ? `openapi-skills generate "${source}"`
        : `openapi-skills generate <openapi-source>`;
    return {
        required: true,
        next_command: cmd,
        reason: "No APIs have been parsed yet. Generate an API first.",
    };
}
export function remediateNoEndpoints(apiName, source) {
    const cmd = source
        ? `openapi-skills generate "${source}" --rename ${apiName}`
        : `openapi-skills generate <openapi-source> --rename ${apiName}`;
    return {
        required: true,
        next_command: cmd,
        reason: `No endpoints.json found for API '${apiName}'. Run generate to create it.`,
    };
}
//# sourceMappingURL=error-formatter.js.map