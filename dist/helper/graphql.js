import fs from "fs-extra";
import path from "path";
import prompts from "prompts";
import { spawn } from "child_process";
import { buildSchema, isEnumType, isInputObjectType, isListType, isNonNullType, isObjectType, isScalarType, } from "graphql";
import { sanitizeOperationPath } from "./sanitizer.js";
import { isInteractive } from "./logger.js";
const scalarNames = new Set(["String", "Int", "Float", "Boolean", "ID"]);
let cachedTypeScriptModule = null;
async function tryLoadTs() {
    if (cachedTypeScriptModule) {
        return cachedTypeScriptModule;
    }
    try {
        const tsModule = await import("typescript");
        cachedTypeScriptModule = tsModule;
        return tsModule;
    }
    catch {
        return null;
    }
}
export async function askToInstallTs() {
    if (!isInteractive) {
        return false;
    }
    const response = await prompts({
        type: "confirm",
        name: "install",
        message: "TypeScript is required to analyze builder GraphQL schemas. Install it now?",
        initial: true,
    });
    return Boolean(response.install);
}
async function installTs() {
    await new Promise((resolve, reject) => {
        const child = spawn("npm", ["install", "typescript"], {
            stdio: "inherit",
            shell: true,
        });
        child.on("error", reject);
        child.on("exit", code => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error("Failed to install TypeScript"));
        });
    });
}
async function loadTsOrInstall() {
    let tsModule = await tryLoadTs();
    if (tsModule) {
        return tsModule;
    }
    const shouldInstall = await askToInstallTs();
    if (!shouldInstall) {
        throw new Error("TypeScript is required for builder schemas. Install it manually with: npm i typescript");
    }
    await installTs();
    tsModule = await tryLoadTs();
    if (!tsModule) {
        throw new Error("TypeScript installation failed.");
    }
    return tsModule;
}
function getTypeScriptModule() {
    if (!cachedTypeScriptModule) {
        throw new Error("TypeScript has not been loaded for builder GraphQL parsing.");
    }
    return cachedTypeScriptModule;
}
export function looksLikeBuilderTsSchema(sourceText, sourcePath) {
    if (sourcePath && path.extname(sourcePath).toLowerCase() === ".ts") {
        return true;
    }
    return [
        /\bbuilder\.queryType\s*\(/,
        /\bbuilder\.mutationType\s*\(/,
        /\bbuilder\.subscriptionType\s*\(/,
        /\bobjectType\s*\(/,
        /\bnew\s+SchemaBuilder\s*\(/,
    ].some(pattern => pattern.test(sourceText));
}
export async function loadSourceText(source) {
    if (/^https?:\/\//i.test(source)) {
        const response = await fetch(source);
        if (!response.ok) {
            throw new Error(`Failed to load GraphQL source from ${source}: HTTP ${response.status}`);
        }
        return await response.text();
    }
    return await fs.readFile(source, "utf8");
}
export function isGraphQL(text) {
    return [
        /\btype\s+Query\b/i,
        /\btype\s+Mutation\b/i,
        /\btype\s+Subscription\b/i,
        /\bschema\s*\{/i,
        /\bextend\s+type\s+Query\b/i,
        /\bbuilder\.(queryType|mutationType|subscriptionType)\s*\(/i,
        /\btoSchema\s*\(/i,
    ].some(pattern => pattern.test(text));
}
function firstStringLiteralValue(node) {
    const ts = getTypeScriptModule();
    if (!node) {
        return undefined;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        return node.text;
    }
    return undefined;
}
function getPropertyAssignment(objectLiteral, propertyName) {
    const ts = getTypeScriptModule();
    if (!objectLiteral) {
        return undefined;
    }
    return objectLiteral.properties.find(property => {
        if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
            const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)
                ? property.name.text
                : property.name.getText();
            return name === propertyName;
        }
        return false;
    });
}
function getPropertyExpression(objectLiteral, propertyName) {
    const ts = getTypeScriptModule();
    const property = getPropertyAssignment(objectLiteral, propertyName);
    if (!property || !ts.isPropertyAssignment(property)) {
        return undefined;
    }
    return property.initializer;
}
function unwrapParenthesized(expression) {
    const ts = getTypeScriptModule();
    let current = expression;
    while (current && ts.isParenthesizedExpression(current)) {
        current = current.expression;
    }
    return current;
}
function getObjectLiteralFromExpression(expression) {
    const ts = getTypeScriptModule();
    const unwrapped = unwrapParenthesized(expression);
    if (!unwrapped) {
        return undefined;
    }
    if (ts.isObjectLiteralExpression(unwrapped)) {
        return unwrapped;
    }
    if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
        if (ts.isBlock(unwrapped.body)) {
            for (const statement of unwrapped.body.statements) {
                if (ts.isReturnStatement(statement) && statement.expression) {
                    const returned = getObjectLiteralFromExpression(statement.expression);
                    if (returned) {
                        return returned;
                    }
                }
            }
            return undefined;
        }
        return getObjectLiteralFromExpression(unwrapped.body);
    }
    return undefined;
}
function getRootTypeFromCallExpression(callExpression) {
    const ts = getTypeScriptModule();
    const expression = callExpression.expression;
    if (!ts.isPropertyAccessExpression(expression)) {
        return undefined;
    }
    const method = expression.name.text;
    if (method === "queryType") {
        return "query";
    }
    if (method === "mutationType") {
        return "mutation";
    }
    if (method === "subscriptionType") {
        return "subscription";
    }
    return undefined;
}
function getTypeNameFromExpression(expression, typeMaps) {
    const ts = getTypeScriptModule();
    const unwrapped = unwrapParenthesized(expression);
    if (!unwrapped) {
        return undefined;
    }
    if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
        return unwrapped.text;
    }
    if (ts.isIdentifier(unwrapped)) {
        return typeMaps.objectTypeNames[unwrapped.text] ?? unwrapped.text;
    }
    return unwrapped.getText();
}
function inferBuilderOutputFieldTypeText(expression, typeMaps) {
    const ts = getTypeScriptModule();
    const unwrapped = unwrapParenthesized(expression);
    if (!unwrapped) {
        return undefined;
    }
    if (ts.isCallExpression(unwrapped)) {
        const callee = unwrapped.expression.getText();
        if (/\.exposeID$/i.test(callee))
            return "ID";
        if (/\.exposeString$/i.test(callee))
            return "String";
        if (/\.exposeInt$/i.test(callee))
            return "Int";
        if (/\.exposeFloat$/i.test(callee))
            return "Float";
        if (/\.exposeBoolean$/i.test(callee))
            return "Boolean";
        if (/\.string$/i.test(callee))
            return "String";
        if (/\.int$/i.test(callee))
            return "Int";
        if (/\.float$/i.test(callee))
            return "Float";
        if (/\.boolean$/i.test(callee))
            return "Boolean";
        if (/\.id$/i.test(callee))
            return "ID";
        if (/\.stringList$/i.test(callee))
            return "[String]";
        if (/\.intList$/i.test(callee))
            return "[Int]";
        if (/\.floatList$/i.test(callee))
            return "[Float]";
        if (/\.booleanList$/i.test(callee))
            return "[Boolean]";
        if (/\.idList$/i.test(callee))
            return "[ID]";
        const firstArg = unwrapped.arguments[0];
        if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
            const typeExpr = getPropertyExpression(firstArg, "type");
            if (typeExpr) {
                const typeName = getTypeNameFromExpression(typeExpr, typeMaps);
                if (typeName) {
                    return typeName;
                }
            }
        }
    }
    return getTypeNameFromExpression(unwrapped, typeMaps);
}
function collectBuilderTypeMaps(sourceFile) {
    const ts = getTypeScriptModule();
    const objectTypeNames = {};
    const rawFields = {};
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && ts.isPropertyAccessExpression(node.initializer.expression)) {
            if (node.initializer.expression.name.text === "objectRef") {
                const firstArg = node.initializer.arguments[0];
                const refName = node.name.getText(sourceFile);
                if (firstArg && ts.isStringLiteral(firstArg)) {
                    objectTypeNames[refName] = firstArg.text;
                }
            }
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "objectType" && node.arguments.length > 1) {
            const typeArg = node.arguments[0];
            const config = getObjectLiteralFromExpression(node.arguments[1]);
            const typeName = getPropertyExpression(config, "name")
                ? firstStringLiteralValue(getPropertyExpression(config, "name"))
                : typeArg && ts.isIdentifier(typeArg)
                    ? objectTypeNames[typeArg.text] ?? typeArg.text
                    : typeArg && ts.isStringLiteral(typeArg)
                        ? typeArg.text
                        : undefined;
            if (typeName && config) {
                const fieldsExpression = getPropertyExpression(config, "fields");
                const fieldsObject = getObjectLiteralFromExpression(fieldsExpression);
                if (fieldsObject) {
                    const fieldSpecs = {};
                    for (const property of fieldsObject.properties) {
                        if (!ts.isPropertyAssignment(property)) {
                            continue;
                        }
                        const fieldName = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)
                            ? property.name.text
                            : property.name.getText(sourceFile);
                        const fieldTypeText = inferBuilderOutputFieldTypeText(property.initializer, { objectTypeNames, objectFields: rawFields });
                        if (fieldTypeText) {
                            fieldSpecs[fieldName] = fieldTypeText;
                        }
                    }
                    rawFields[typeName] = fieldSpecs;
                }
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return { objectTypeNames, objectFields: rawFields };
}
function resolveBuilderOutputDescriptor(typeText, typeMaps, visited = new Set()) {
    const normalized = typeText.trim();
    if (!normalized) {
        return { kind: "unknown", typeName: "Unknown" };
    }
    if (normalized.endsWith("!")) {
        return {
            kind: "non-null",
            typeName: normalized,
            required: true,
            ofType: resolveBuilderOutputDescriptor(normalized.slice(0, -1), typeMaps, visited),
        };
    }
    if (normalized.startsWith("[") && normalized.endsWith("]")) {
        return {
            kind: "list",
            typeName: normalized,
            ofType: resolveBuilderOutputDescriptor(normalized.slice(1, -1).trim(), typeMaps, visited),
        };
    }
    if (scalarNames.has(normalized)) {
        return { kind: "scalar", typeName: normalized };
    }
    const objectTypeName = typeMaps.objectTypeNames[normalized] ?? normalized;
    if (visited.has(objectTypeName)) {
        return { kind: "object", typeName: objectTypeName, circular: objectTypeName, fields: {} };
    }
    const fieldSpecs = typeMaps.objectFields[objectTypeName];
    if (!fieldSpecs) {
        return { kind: "object", typeName: objectTypeName };
    }
    const nextVisited = new Set(visited);
    nextVisited.add(objectTypeName);
    const fields = {};
    for (const [fieldName, fieldTypeText] of Object.entries(fieldSpecs)) {
        fields[fieldName] = resolveBuilderOutputDescriptor(fieldTypeText, typeMaps, nextVisited);
    }
    return {
        kind: "object",
        typeName: objectTypeName,
        fields,
    };
}
function isTypeWrapperText(typeText) {
    return /^\[.*\]!?$/.test(typeText.trim()) || /!$/.test(typeText.trim());
}
function stripWrappers(typeText) {
    let normalized = typeText.trim();
    while (normalized.endsWith("!")) {
        normalized = normalized.slice(0, -1).trim();
    }
    if (normalized.startsWith("[") && normalized.endsWith("]")) {
        normalized = normalized.slice(1, -1).trim();
    }
    return normalized;
}
function classifyTypeName(typeText, isInput) {
    const normalized = stripWrappers(typeText);
    if (scalarNames.has(normalized)) {
        return "scalar";
    }
    if (isInput && /input|filter|where|args?/i.test(normalized)) {
        return "input-object";
    }
    return isInput ? "input-object" : "object";
}
function inferTypeDescriptorFromText(typeText, isInput) {
    const normalized = typeText.trim();
    if (!normalized) {
        return { kind: "unknown", typeName: "Unknown" };
    }
    if (normalized.endsWith("!")) {
        return {
            kind: "non-null",
            typeName: normalized,
            required: true,
            ofType: inferTypeDescriptorFromText(normalized.slice(0, -1), isInput),
        };
    }
    if (normalized.startsWith("[") && normalized.endsWith("]")) {
        const inner = normalized.slice(1, -1).trim();
        return {
            kind: "list",
            typeName: normalized,
            ofType: inferTypeDescriptorFromText(inner, isInput),
        };
    }
    const kind = classifyTypeName(normalized, isInput);
    return {
        kind,
        typeName: normalized,
    };
}
function inferLiteralValue(expression) {
    const ts = getTypeScriptModule();
    const unwrapped = unwrapParenthesized(expression);
    if (!unwrapped) {
        return undefined;
    }
    if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
        return unwrapped.text;
    }
    if (ts.isNumericLiteral(unwrapped)) {
        return Number(unwrapped.text);
    }
    if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) {
        return true;
    }
    if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) {
        return false;
    }
    if (unwrapped.kind === ts.SyntaxKind.NullKeyword) {
        return null;
    }
    if (ts.isArrayLiteralExpression(unwrapped)) {
        return unwrapped.elements.map(element => inferLiteralValue(element));
    }
    if (ts.isObjectLiteralExpression(unwrapped)) {
        const out = {};
        for (const property of unwrapped.properties) {
            if (ts.isPropertyAssignment(property)) {
                const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)
                    ? property.name.text
                    : property.name.getText();
                out[name] = inferLiteralValue(property.initializer);
            }
        }
        return out;
    }
    if (ts.isIdentifier(unwrapped) && unwrapped.text === "undefined") {
        return undefined;
    }
    return undefined;
}
function inferArgDescriptorFromExpression(expression) {
    const ts = getTypeScriptModule();
    const unwrapped = unwrapParenthesized(expression);
    if (!unwrapped) {
        return { kind: "unknown", typeName: "Unknown" };
    }
    if (ts.isCallExpression(unwrapped)) {
        const callee = unwrapped.expression.getText();
        const firstArg = unwrapped.arguments[0];
        if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
            const typeExpr = getPropertyExpression(firstArg, "type");
            const requiredExpr = getPropertyExpression(firstArg, "required");
            const defaultExpr = getPropertyExpression(firstArg, "defaultValue");
            let descriptor;
            if (typeExpr) {
                descriptor = inferTypeDescriptorFromText(typeExpr.getText(), true);
            }
            else if (/\.string$/i.test(callee)) {
                descriptor = { kind: "scalar", typeName: "String" };
            }
            else if (/\.int$/i.test(callee)) {
                descriptor = { kind: "scalar", typeName: "Int" };
            }
            else if (/\.float$/i.test(callee)) {
                descriptor = { kind: "scalar", typeName: "Float" };
            }
            else if (/\.boolean$/i.test(callee)) {
                descriptor = { kind: "scalar", typeName: "Boolean" };
            }
            else if (/\.id$/i.test(callee)) {
                descriptor = { kind: "scalar", typeName: "ID" };
            }
            if (descriptor) {
                descriptor.defaultValue = inferLiteralValue(defaultExpr);
                if (requiredExpr && inferLiteralValue(requiredExpr) === true) {
                    return {
                        kind: "non-null",
                        typeName: `${descriptor.typeName}!`,
                        required: true,
                        ofType: descriptor,
                    };
                }
                return descriptor;
            }
        }
        if (/\.string$/i.test(callee)) {
            return { kind: "scalar", typeName: "String" };
        }
        if (/\.int$/i.test(callee)) {
            return { kind: "scalar", typeName: "Int" };
        }
        if (/\.float$/i.test(callee)) {
            return { kind: "scalar", typeName: "Float" };
        }
        if (/\.boolean$/i.test(callee)) {
            return { kind: "scalar", typeName: "Boolean" };
        }
        if (/\.id$/i.test(callee)) {
            return { kind: "scalar", typeName: "ID" };
        }
    }
    return inferTypeDescriptorFromText(unwrapped.getText(), true);
}
function inferOutputDescriptorFromTypeText(typeText) {
    return inferTypeDescriptorFromText(typeText, false);
}
function buildScalarDefault(typeName) {
    const baseType = stripWrappers(typeName);
    if (baseType === "Boolean") {
        return false;
    }
    if (baseType === "Int" || baseType === "Float") {
        return 0;
    }
    if (baseType === "ID" || baseType === "String") {
        return "";
    }
    return null;
}
function buildDefaultValue(descriptor) {
    if (descriptor.kind === "non-null" && descriptor.ofType) {
        return buildDefaultValue(descriptor.ofType);
    }
    if (descriptor.kind === "list") {
        return [];
    }
    if (descriptor.kind === "scalar") {
        return buildScalarDefault(descriptor.typeName);
    }
    if (descriptor.kind === "enum") {
        return descriptor.enumValues?.[0] ?? null;
    }
    if (descriptor.kind === "input-object") {
        const out = {};
        for (const [key, value] of Object.entries(descriptor.fields ?? {})) {
            out[key] = buildDefaultValue(value);
        }
        return out;
    }
    return null;
}
function descriptorToTypeString(descriptor) {
    if (descriptor.kind === "non-null" && descriptor.ofType) {
        return `${descriptorToTypeString(descriptor.ofType)}!`;
    }
    if (descriptor.kind === "list" && descriptor.ofType) {
        return `[${descriptorToTypeString(descriptor.ofType)}]`;
    }
    return descriptor.typeName;
}
function isLeafDescriptor(descriptor) {
    const typeName = stripWrappers(descriptor.typeName);
    return descriptor.kind === "scalar" || descriptor.kind === "enum" || scalarNames.has(typeName);
}
function buildSelectionSet(descriptor, seen = new Set()) {
    if (descriptor.kind === "non-null" && descriptor.ofType) {
        return buildSelectionSet(descriptor.ofType, seen);
    }
    if (descriptor.kind === "list" && descriptor.ofType) {
        return buildSelectionSet(descriptor.ofType, seen);
    }
    if (isLeafDescriptor(descriptor)) {
        return "";
    }
    const typeName = stripWrappers(descriptor.typeName);
    if (seen.has(typeName)) {
        return "__typename";
    }
    if (descriptor.kind === "object" || descriptor.kind === "input-object") {
        const childSeen = new Set(seen);
        childSeen.add(typeName);
        const fieldEntries = Object.entries(descriptor.fields ?? {});
        if (fieldEntries.length === 0) {
            return "{ __typename }";
        }
        const childSelections = fieldEntries.map(([name, childDescriptor]) => {
            const nestedSelection = buildSelectionSet(childDescriptor, childSeen);
            if (!nestedSelection) {
                return name;
            }
            if (childDescriptor.kind === "object" || childDescriptor.kind === "input-object" || childDescriptor.kind === "list" || childDescriptor.kind === "non-null") {
                const wrappedSelection = nestedSelection.startsWith("{") ? nestedSelection : `{ ${nestedSelection} }`;
                return `${name} ${wrappedSelection}`;
            }
            return `${name} ${nestedSelection}`;
        });
        return `{ ${childSelections.join(" ")} }`;
    }
    return "__typename";
}
function buildQueryFromEndpoint(endpoint) {
    const variableNames = Object.keys(endpoint.args);
    const variableDeclarations = variableNames.map(name => {
        const descriptor = endpoint.args[name];
        return `$${name}: ${descriptor ? descriptorToTypeString(descriptor) : "String"}`;
    });
    const variables = {};
    for (const [name, descriptor] of Object.entries(endpoint.args)) {
        variables[name] = buildDefaultValue(descriptor);
    }
    const callArguments = variableNames.map(name => `${name}: $${name}`).join(", ");
    const selectionSet = buildSelectionSet(endpoint.returns);
    const fieldSelection = selectionSet ? ` ${selectionSet}` : "";
    const operationName = sanitizeOperationPath(endpoint.operationId) || endpoint.operationId;
    const variableDeclarationText = variableDeclarations.length > 0 ? `(${variableDeclarations.join(", ")})` : "";
    const callArgumentText = callArguments.length > 0 ? `(${callArguments})` : "";
    return {
        query: `${endpoint.rootType} ${operationName}${variableDeclarationText} { ${endpoint.name}${callArgumentText}${fieldSelection} }`,
        variables,
    };
}
function extractGraphQLEndpointsFromSDL(sourceText) {
    const schema = buildSchema(sourceText);
    const rootTypes = [
        ["query", schema.getQueryType()],
        ["mutation", schema.getMutationType()],
        ["subscription", schema.getSubscriptionType()],
    ];
    const endpoints = [];
    for (const [rootType, root] of rootTypes) {
        if (!root) {
            continue;
        }
        for (const field of Object.values(root.getFields())) {
            const args = {};
            for (const arg of field.args) {
                const descriptor = describeInputType(arg.type);
                if (arg.defaultValue !== undefined) {
                    descriptor.defaultValue = arg.defaultValue;
                }
                args[arg.name] = descriptor;
            }
            const endpoint = {
                name: field.name,
                operationId: field.name,
                sanitizedOperationId: sanitizeOperationPath(field.name),
                rootType,
                args,
                returns: describeOutputType(field.type),
            };
            const summary = field.description?.split("\n").map(line => line.trim()).filter(Boolean)[0];
            if (summary) {
                endpoint.summary = summary;
            }
            if (field.description) {
                endpoint.description = field.description;
            }
            endpoints.push(endpoint);
        }
    }
    return endpoints;
}
function describeInputType(type, visited = new Set()) {
    if (isNonNullType(type)) {
        return {
            kind: "non-null",
            typeName: type.toString(),
            required: true,
            ofType: describeInputType(type.ofType, visited),
        };
    }
    if (isListType(type)) {
        return {
            kind: "list",
            typeName: type.toString(),
            ofType: describeInputType(type.ofType, visited),
        };
    }
    if (isScalarType(type)) {
        return { kind: "scalar", typeName: type.name };
    }
    if (isEnumType(type)) {
        return { kind: "enum", typeName: type.name, enumValues: type.getValues().map(value => value.name) };
    }
    if (isInputObjectType(type)) {
        if (visited.has(type.name)) {
            return { kind: "input-object", typeName: type.name, circular: type.name, fields: {} };
        }
        const nextVisited = new Set(visited);
        nextVisited.add(type.name);
        const fields = {};
        for (const [fieldName, field] of Object.entries(type.getFields())) {
            const descriptor = describeInputType(field.type, nextVisited);
            if (field.defaultValue !== undefined) {
                descriptor.defaultValue = field.defaultValue;
            }
            fields[fieldName] = descriptor;
        }
        return {
            kind: "input-object",
            typeName: type.name,
            fields,
        };
    }
    return { kind: "unknown", typeName: String(type) };
}
function describeOutputType(type, visited = new Set()) {
    if (isNonNullType(type)) {
        return {
            kind: "non-null",
            typeName: type.toString(),
            required: true,
            ofType: describeOutputType(type.ofType, visited),
        };
    }
    if (isListType(type)) {
        return {
            kind: "list",
            typeName: type.toString(),
            ofType: describeOutputType(type.ofType, visited),
        };
    }
    if (isScalarType(type)) {
        return { kind: "scalar", typeName: type.name };
    }
    if (isEnumType(type)) {
        return { kind: "enum", typeName: type.name, enumValues: type.getValues().map(value => value.name) };
    }
    if (isObjectType(type)) {
        if (visited.has(type.name)) {
            return { kind: "object", typeName: type.name, circular: type.name, fields: {} };
        }
        const nextVisited = new Set(visited);
        nextVisited.add(type.name);
        const fields = {};
        for (const [fieldName, field] of Object.entries(type.getFields())) {
            fields[fieldName] = describeOutputType(field.type, nextVisited);
        }
        return {
            kind: "object",
            typeName: type.name,
            fields,
        };
    }
    return { kind: "unknown", typeName: type.toString() };
}
async function extractGraphQLEndpointsFromBuilderSource(sourceText) {
    const ts = await loadTsOrInstall();
    const sourceFile = ts.createSourceFile("graphql-source.ts", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const typeMaps = collectBuilderTypeMaps(sourceFile);
    const endpoints = [];
    function visit(node) {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const rootType = getRootTypeFromCallExpression(node);
            if (rootType && node.arguments.length > 0) {
                const config = getObjectLiteralFromExpression(node.arguments[0]);
                const fieldsExpression = getPropertyExpression(config, "fields");
                const fieldsObject = getObjectLiteralFromExpression(fieldsExpression);
                if (fieldsObject) {
                    for (const property of fieldsObject.properties) {
                        if (!ts.isPropertyAssignment(property)) {
                            continue;
                        }
                        const rawName = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)
                            ? property.name.text
                            : property.name.getText(sourceFile);
                        const fieldConfig = getObjectLiteralFromExpression(property.initializer) ?? getObjectLiteralFromExpression(property.initializer);
                        const maybeFieldExpression = unwrapParenthesized(property.initializer);
                        const fieldCallExpression = maybeFieldExpression && ts.isCallExpression(maybeFieldExpression) ? maybeFieldExpression : undefined;
                        const callArgumentsObject = fieldCallExpression ? getObjectLiteralFromExpression(fieldCallExpression.arguments[0]) : fieldConfig;
                        const typeExpression = getPropertyExpression(callArgumentsObject, "type");
                        const summary = firstStringLiteralValue(getPropertyExpression(callArgumentsObject, "summary"));
                        const description = firstStringLiteralValue(getPropertyExpression(callArgumentsObject, "description"));
                        const argsExpression = getPropertyExpression(callArgumentsObject, "args");
                        const argsObject = getObjectLiteralFromExpression(argsExpression);
                        const args = {};
                        if (argsObject) {
                            for (const argProperty of argsObject.properties) {
                                if (!ts.isPropertyAssignment(argProperty)) {
                                    continue;
                                }
                                const argName = ts.isIdentifier(argProperty.name) || ts.isStringLiteral(argProperty.name) || ts.isNumericLiteral(argProperty.name)
                                    ? argProperty.name.text
                                    : argProperty.name.getText(sourceFile);
                                args[argName] = inferArgDescriptorFromExpression(argProperty.initializer);
                            }
                        }
                        const endpoint = {
                            name: rawName,
                            operationId: rawName,
                            sanitizedOperationId: sanitizeOperationPath(rawName),
                            rootType,
                            args,
                            returns: typeExpression ? resolveBuilderOutputDescriptor(typeExpression.getText(sourceFile), typeMaps) : { kind: "unknown", typeName: "Unknown" },
                        };
                        if (summary) {
                            endpoint.summary = summary;
                        }
                        if (description) {
                            endpoint.description = description;
                        }
                        endpoints.push(endpoint);
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return endpoints;
}
export async function extractGraphQLEndpoints(sourceText, sourcePath) {
    if (looksLikeBuilderTsSchema(sourceText, sourcePath)) {
        return await extractGraphQLEndpointsFromBuilderSource(sourceText);
    }
    return extractGraphQLEndpointsFromSDL(sourceText);
}
export async function findGraphQLEndpoint(sourceText, rootType, fieldName, sourcePath) {
    const endpoints = await extractGraphQLEndpoints(sourceText, sourcePath);
    const endpoint = endpoints.find(entry => entry.rootType === rootType && entry.name === fieldName);
    if (!endpoint) {
        throw new Error(`GraphQL field '${fieldName}' not found on root type '${rootType}'.`);
    }
    return endpoint;
}
export function buildGraphQLArtifact(endpoint) {
    return buildQueryFromEndpoint(endpoint);
}
export function buildGraphQLOperationSchema(endpoint) {
    return endpoint;
}
export function getGraphQLRootTypeFromMethod(method) {
    const normalized = method.toLowerCase();
    if (normalized === "query" || normalized === "mutation" || normalized === "subscription") {
        return normalized;
    }
    return undefined;
}
export function isGraphQLTypeName(typeName) {
    const normalized = stripWrappers(typeName);
    return !scalarNames.has(normalized);
}
export function defaultValueForDescriptor(descriptor) {
    return buildDefaultValue(descriptor);
}
export function typeStringForDescriptor(descriptor) {
    return descriptorToTypeString(descriptor);
}
export function selectionSetForDescriptor(descriptor) {
    return buildSelectionSet(descriptor);
}
export function descriptorIsLeaf(descriptor) {
    return isLeafDescriptor(descriptor);
}
//# sourceMappingURL=graphql.js.map