function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function getRequestBodySchema(operationSchema) {
    const requestBody = operationSchema.requestBody;
    if (isObject(requestBody) && isObject(requestBody.content)) {
        for (const content of Object.values(requestBody.content)) {
            if (isObject(content) && content.schema) {
                return content.schema;
            }
        }
    }
    const parameters = Array.isArray(operationSchema.parameters) ? operationSchema.parameters : [];
    const bodyParameter = parameters.find(parameter => isObject(parameter) && parameter.in === "body");
    if (isObject(bodyParameter) && bodyParameter.schema) {
        return bodyParameter.schema;
    }
    const formParameters = parameters.filter(parameter => isObject(parameter) && parameter.in === "formData");
    if (formParameters.length === 0) {
        return undefined;
    }
    const properties = {};
    const required = [];
    for (const parameter of formParameters) {
        if (!isObject(parameter) || typeof parameter.name !== "string") {
            continue;
        }
        properties[parameter.name] = isObject(parameter.schema)
            ? parameter.schema
            : Object.fromEntries(["type", "items", "format", "enum"]
                .filter(key => parameter[key] !== undefined)
                .map(key => [key, parameter[key]]));
        if (parameter.required === true) {
            required.push(parameter.name);
        }
    }
    return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
    };
}
function flattenAllOf(schemas) {
    const flattened = [];
    const active = new Set();
    let ambiguous = false;
    const visit = (schema) => {
        if (!isObject(schema)) {
            ambiguous = true;
            return;
        }
        if (active.has(schema)) {
            ambiguous = true;
            return;
        }
        if ("$ref" in schema || "oneOf" in schema || "anyOf" in schema || "not" in schema) {
            ambiguous = true;
            return;
        }
        active.add(schema);
        flattened.push(schema);
        if (Array.isArray(schema.allOf)) {
            for (const member of schema.allOf) {
                visit(member);
            }
        }
        active.delete(schema);
    };
    for (const schema of schemas) {
        visit(schema);
    }
    return { schemas: flattened, ambiguous };
}
function pruneOpenApiValue(value, schemas) {
    const flattened = flattenAllOf(schemas);
    if (flattened.ambiguous) {
        return false;
    }
    const constraints = flattened.schemas;
    if (Array.isArray(value)) {
        const itemSchemas = constraints
            .map(schema => schema.items)
            .filter((schema) => isObject(schema));
        if (itemSchemas.length === 0) {
            return false;
        }
        return value.reduce((changed, item) => pruneOpenApiValue(item, itemSchemas) || changed, false);
    }
    if (!isObject(value)) {
        return false;
    }
    const required = new Set(constraints.flatMap(schema => Array.isArray(schema.required)
        ? schema.required.filter((field) => typeof field === "string")
        : []));
    const propertySchemas = new Map();
    for (const constraint of constraints) {
        if (!isObject(constraint.properties)) {
            continue;
        }
        for (const [name, schema] of Object.entries(constraint.properties)) {
            const schemasForProperty = propertySchemas.get(name) ?? [];
            schemasForProperty.push(schema);
            propertySchemas.set(name, schemasForProperty);
        }
    }
    let changed = false;
    for (const [name, fieldValue] of Object.entries(value)) {
        const schemasForProperty = propertySchemas.get(name);
        if (!schemasForProperty) {
            continue;
        }
        if (fieldValue === "" && !required.has(name)) {
            delete value[name];
            changed = true;
            continue;
        }
        changed = pruneOpenApiValue(fieldValue, schemasForProperty) || changed;
    }
    return changed;
}
export function omitOpenApiEmptyOptionalFields(requestJson, operationSchema) {
    if (!isObject(requestJson) || !isObject(operationSchema)) {
        return false;
    }
    let changed = false;
    if (Array.isArray(requestJson.parameters) && Array.isArray(operationSchema.parameters)) {
        const operationParameters = operationSchema.parameters.filter(isObject);
        const filteredParameters = requestJson.parameters.filter(parameter => {
            if (!isObject(parameter) || parameter.value !== "" || !["path", "query", "header"].includes(String(parameter.in))) {
                return true;
            }
            const definition = operationParameters.find(candidate => candidate.name === parameter.name && candidate.in === parameter.in);
            if (!definition || parameter.in === "path" || definition.required === true) {
                return true;
            }
            changed = true;
            return false;
        });
        if (changed) {
            requestJson.parameters = filteredParameters;
        }
    }
    const requestBodySchema = getRequestBodySchema(operationSchema);
    if (requestBodySchema && "requestBody" in requestJson) {
        changed = pruneOpenApiValue(requestJson.requestBody, [requestBodySchema]) || changed;
    }
    return changed;
}
function unwrapGraphQLDescriptor(descriptor) {
    let current = descriptor;
    while (current && current.kind === "non-null" && current.ofType) {
        current = current.ofType;
    }
    return current;
}
function isGraphQLRequired(descriptor) {
    if (!descriptor) {
        return false;
    }
    let current = descriptor;
    while (current) {
        if (current.defaultValue !== undefined) {
            return false;
        }
        current = current.ofType;
    }
    return descriptor.required === true
        || descriptor.kind === "non-null"
        || descriptor.typeName.trim().endsWith("!");
}
function pruneGraphQLNestedValue(value, descriptor) {
    if (Array.isArray(value)) {
        const unwrapped = unwrapGraphQLDescriptor(descriptor);
        if (unwrapped?.kind !== "list" || !unwrapped.ofType) {
            return false;
        }
        return value.reduce((changed, item) => pruneGraphQLNestedValue(item, unwrapped.ofType) || changed, false);
    }
    if (!isObject(value)) {
        return false;
    }
    const unwrapped = unwrapGraphQLDescriptor(descriptor);
    if (unwrapped?.kind !== "input-object" || !unwrapped.fields) {
        return false;
    }
    return pruneGraphQLFields(value, unwrapped.fields);
}
function pruneGraphQLFields(fields, descriptors) {
    let changed = false;
    for (const [name, value] of Object.entries(fields)) {
        const descriptor = descriptors[name];
        if (!descriptor) {
            continue;
        }
        if (value === "" && !isGraphQLRequired(descriptor)) {
            delete fields[name];
            changed = true;
            continue;
        }
        changed = pruneGraphQLNestedValue(value, descriptor) || changed;
    }
    return changed;
}
export function omitGraphQLEmptyOptionalFields(requestJson, operationSchema) {
    if (!isObject(requestJson) || !isObject(requestJson.variables)) {
        return false;
    }
    return pruneGraphQLFields(requestJson.variables, operationSchema.args);
}
//# sourceMappingURL=request-omit-empty.js.map