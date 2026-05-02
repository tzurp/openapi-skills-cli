export declare const isInteractive: boolean;
export declare const logger: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    progress(message: string): void;
    progressLine(message: string): void;
    result(data: any): void;
};
export declare function emitJsonError(error: string, details?: string): void;
export declare function emitCommandError(label: string, details: string): void;
export declare function toErrorMessage(error: unknown): string;
export declare function logGeneratedPaths(lines: string[]): void;
//# sourceMappingURL=logger.d.ts.map