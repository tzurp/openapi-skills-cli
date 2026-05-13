import { ErrorCode } from "./error-codes.js";
import type { ErrorCategory, ErrorSeverity } from "./error-codes.js";
export interface ResponseContext {
    api_name?: string | null;
    operation_id?: string | null;
    artifact_type?: string | null;
    [key: string]: unknown;
}
export interface Remediation {
    required: boolean;
    next_command: string;
    reason: string;
}
export interface ErrorResponse {
    ok: false;
    error: {
        code: ErrorCode;
        category: ErrorCategory;
        severity: ErrorSeverity;
        summary: string;
        message: string;
        remediation: Remediation;
        context: ResponseContext;
    };
}
export interface SuccessResponse {
    ok: true;
    kind?: string;
    data?: unknown;
}
export declare function buildError(code: ErrorCode, options: {
    summary: string;
    message: string;
    nextCommand?: string;
    reason?: string;
    context?: ResponseContext;
    severity?: ErrorSeverity;
}): ErrorResponse;
export declare function buildSuccess(data?: unknown, options?: {
    kind?: string;
}): SuccessResponse;
export declare function successResult(kind: string, payload: unknown): SuccessResponse;
export declare function successList(items: unknown[]): unknown[];
export declare function remediateUnknownApi(apiName: string): Remediation;
export declare function remediateMissingParsedApi(source?: string): Remediation;
export declare function remediateNoEndpoints(apiName: string, source?: string): Remediation;
//# sourceMappingURL=error-formatter.d.ts.map