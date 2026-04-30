type RawParameter = {
    name?: unknown;
    in?: unknown;
    description?: unknown;
    required?: unknown;
    schema?: unknown;
    type?: unknown;
    format?: unknown;
    items?: unknown;
    enum?: unknown;
};
export declare function resolveParameterSchema(parameter: RawParameter | undefined): Record<string, unknown> | undefined;
export declare function getParameterDefaultValue(parameter: RawParameter | undefined): unknown;
export {};
//# sourceMappingURL=parameter-schema.d.ts.map