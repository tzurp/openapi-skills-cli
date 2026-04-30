function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
export function resolveParameterSchema(parameter) {
    if (!parameter || typeof parameter !== "object") {
        return undefined;
    }
    if (isPlainObject(parameter.schema)) {
        return parameter.schema;
    }
    return parameter;
}
export function getParameterDefaultValue(parameter) {
    const schema = resolveParameterSchema(parameter);
    const type = typeof schema?.type === "string"
        ? schema.type
        : typeof parameter?.type === "string"
            ? parameter.type
            : undefined;
    switch (type) {
        case "string":
            return "";
        case "number":
        case "integer":
            return 0;
        case "boolean":
            return false;
        case "array":
            return [];
        case "object":
            return {};
        default:
            return null;
    }
}
//# sourceMappingURL=parameter-schema.js.map