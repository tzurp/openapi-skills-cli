import fs from "fs-extra";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import { buildSchema, Kind, parse, isEnumType, isInputObjectType, isListType, isNonNullType, isObjectType, isScalarType, } from "graphql";
import { sanitizeOperationPath } from "./sanitizer.js";
const scalarNames = new Set(["String", "Int", "Float", "Boolean", "ID"]);
export const typescriptInstallCommand = "npm install typescript";
const typescriptAstModuleSpecifiers = [
    "typescript/ast",
    "typescript",
    "typescript/unstable/ast",
];
const typescriptSyncModuleSpecifiers = [
    "typescript/sync",
    "typescript",
    "typescript/unstable/sync",
];
let cachedTypeScriptModule = null;
let cachedTypeScriptApi = null;
function collectErrorMessages(error) {
    if (!(error instanceof Error)) {
        return [String(error)];
    }
    const messages = [error.message];
    const cause = error.cause;
    if (cause instanceof Error) {
        messages.push(...collectErrorMessages(cause));
    }
    else if (cause !== undefined && cause !== null) {
        messages.push(String(cause));
    }
    return messages;
}
function isMissingTypeScriptModuleMessage(message) {
    if (!/typescript/i.test(message)) {
        return false;
    }
    if (!/(?:Cannot find (?:package|module)|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND)/i.test(message)) {
        return false;
    }
    return /['"]typescript(?:\/(?:unstable\/)?(?:ast|sync))?['"]/i.test(message)
        || /Cannot find typescript(?:\/(?:unstable\/)?(?:ast|sync))?/i.test(message);
}
export function isTypeScriptUnavailableError(error) {
    return collectErrorMessages(error).some(message => /TypeScript is required to analyze builder GraphQL schemas/i.test(message)
        || isMissingTypeScriptModuleMessage(message));
}
function resolveTypeScriptModule(specifier) {
    const candidates = [
        createRequire(import.meta.url),
        createRequire(path.join(process.cwd(), "package.json")),
    ];
    for (const require of candidates) {
        try {
            return pathToFileURL(require.resolve(specifier)).href;
        }
        catch {
        }
    }
    throw new Error(`Cannot find ${specifier}`);
}
async function importTypeScriptModule() {
    let lastError;
    for (const specifier of typescriptAstModuleSpecifiers) {
        try {
            const module = await importTypeScriptAstSpecifier(specifier);
            if (typeof module.isCallExpression === "function") {
                return module;
            }
            lastError = new Error(`TypeScript module '${specifier}' does not export the AST API.`);
        }
        catch (error) {
            lastError = error;
            try {
                const module = await import(resolveTypeScriptModule(specifier));
                if (typeof module.isCallExpression === "function") {
                    return module;
                }
                lastError = new Error(`TypeScript module '${specifier}' does not export the AST API.`);
            }
            catch (resolvedError) {
                lastError = resolvedError;
            }
        }
    }
    throw lastError ?? new Error("TypeScript is required to analyze builder GraphQL schemas.");
}
async function importTypeScriptAstSpecifier(specifier) {
    return await import(specifier);
}
async function importTypeScriptApi() {
    let lastError;
    for (const specifier of typescriptSyncModuleSpecifiers) {
        try {
            const module = await importTypeScriptSyncSpecifier(specifier);
            if (typeof module.API === "function") {
                return module.API;
            }
            const legacyApi = createLegacyTypeScriptApi(module);
            if (legacyApi) {
                return legacyApi;
            }
            lastError = new Error(`TypeScript module '${specifier}' does not export API.`);
        }
        catch (error) {
            lastError = error;
            try {
                const module = await import(resolveTypeScriptModule(specifier));
                if (typeof module.API === "function") {
                    return module.API;
                }
                const legacyApi = createLegacyTypeScriptApi(module);
                if (legacyApi) {
                    return legacyApi;
                }
                lastError = new Error(`TypeScript module '${specifier}' does not export API.`);
            }
            catch (resolvedError) {
                lastError = resolvedError;
            }
        }
    }
    throw lastError ?? new Error("TypeScript is required to analyze builder GraphQL schemas.");
}
function createLegacyTypeScriptApi(module) {
    if (typeof module.createSourceFile !== "function" || !module.ScriptTarget || !module.ScriptKind) {
        return null;
    }
    return class LegacyTypeScriptApi {
        updateSnapshot(options) {
            const fileName = options.openFiles[0];
            const sourceText = fs.readFileSync(fileName, "utf8");
            const sourceFile = module.createSourceFile(fileName, sourceText, module.ScriptTarget.Latest, true, module.ScriptKind.TS);
            return {
                getDefaultProjectForFile: () => ({
                    program: {
                        getSourceFile: () => sourceFile,
                    },
                }),
                dispose: () => undefined,
            };
        }
        close() {
        }
    };
}
async function importTypeScriptSyncSpecifier(specifier) {
    return await import(specifier);
}
async function loadTsOrInstall() {
    if (cachedTypeScriptModule && cachedTypeScriptApi) {
        return cachedTypeScriptModule;
    }
    try {
        cachedTypeScriptModule = await importTypeScriptModule();
        cachedTypeScriptApi = await importTypeScriptApi();
    }
    catch (error) {
        throw new Error("TypeScript is required to analyze builder GraphQL schemas.", { cause: error });
    }
    return cachedTypeScriptModule;
}
function getTypeScriptModule() {
    if (!cachedTypeScriptModule) {
        throw new Error("TypeScript has not been loaded.");
    }
    return cachedTypeScriptModule;
}
async function parseSourceFile(sourceText, sourcePath) {
    await loadTsOrInstall();
    const extension = path.extname(sourcePath ?? "").toLowerCase();
    const fileName = `graphql-source${extension === ".tsx" || extension === ".jsx" ? extension : ".ts"}`;
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "openapi-skills-graphql-"));
    const tempFile = path.join(tempDirectory, fileName);
    await fs.writeFile(tempFile, sourceText, "utf8");
    if (!cachedTypeScriptApi) {
        throw new Error("TypeScript API has not been loaded.");
    }
    const api = new cachedTypeScriptApi();
    const snapshot = api.updateSnapshot({ openFiles: [tempFile] });
    try {
        const project = snapshot.getDefaultProjectForFile(tempFile);
        const sourceFile = project?.program.getSourceFile(tempFile);
        if (!sourceFile) {
            throw new Error("TypeScript could not parse the GraphQL builder source.");
        }
        return sourceFile;
    }
    finally {
        snapshot.dispose();
        api.close();
        await fs.remove(tempDirectory);
    }
}
export function looksLikeBuilderTsSchema(sourceText, sourcePath) {
    if (sourcePath && [".ts", ".tsx", ".mts", ".cts"].includes(path.extname(sourcePath).toLowerCase())) {
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
function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
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
    return objectLiteral.properties.find((property) => {
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
        node.forEachChild(visit);
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
        return unwrapped.elements.map((element) => inferLiteralValue(element));
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
async function extractGraphQLEndpointsFromBuilderSource(sourceText, sourcePath) {
    const ts = await loadTsOrInstall();
    const sourceFile = await parseSourceFile(sourceText, sourcePath);
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
        node.forEachChild(visit);
    }
    visit(sourceFile);
    return endpoints;
}
export async function extractGraphQLEndpoints(sourceText, sourcePath) {
    if (looksLikeBuilderTsSchema(sourceText, sourcePath)) {
        return await extractGraphQLEndpointsFromBuilderSource(sourceText, sourcePath);
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
export function buildGraphQLResponseData(descriptor, seen = new Set()) {
    if (descriptor.kind === "non-null" && descriptor.ofType) {
        return buildGraphQLResponseData(descriptor.ofType, seen);
    }
    if (descriptor.kind === "list" && descriptor.ofType) {
        return [buildGraphQLResponseData(descriptor.ofType, new Set(seen))];
    }
    if (descriptor.kind === "scalar" || descriptor.kind === "enum") {
        return defaultValueForDescriptor(descriptor);
    }
    if (descriptor.kind === "object" || descriptor.kind === "input-object") {
        const typeName = descriptor.typeName.trim();
        if (typeName && seen.has(typeName)) {
            return { __typename: typeName };
        }
        const nextSeen = new Set(seen);
        if (typeName) {
            nextSeen.add(typeName);
        }
        const out = {};
        for (const [fieldName, fieldDescriptor] of Object.entries(descriptor.fields ?? {})) {
            out[fieldName] = buildGraphQLResponseData(fieldDescriptor, nextSeen);
        }
        return out;
    }
    return null;
}
function unwrapGraphQLDescriptor(descriptor) {
    if (descriptor.kind === "non-null" && descriptor.ofType) {
        return unwrapGraphQLDescriptor(descriptor.ofType);
    }
    return descriptor;
}
function getGraphQLDescriptorTypeName(descriptor) {
    const unwrapped = unwrapGraphQLDescriptor(descriptor);
    return unwrapped.typeName;
}
function parseGraphQLSelection(requestBody, rootFieldName) {
    if (!isPlainObject(requestBody)) {
        return undefined;
    }
    const query = typeof requestBody.query === "string" ? requestBody.query.trim() : "";
    if (!query) {
        return undefined;
    }
    let document;
    try {
        document = parse(query);
    }
    catch {
        return undefined;
    }
    const operationName = typeof requestBody.operationName === "string" ? requestBody.operationName.trim() : "";
    const operations = document.definitions.filter((definition) => definition.kind === Kind.OPERATION_DEFINITION);
    const operation = operationName
        ? operations.find(entry => entry.name?.value === operationName) ?? operations[0]
        : operations[0];
    if (!operation) {
        return undefined;
    }
    for (const selection of operation.selectionSet.selections) {
        if (selection.kind !== Kind.FIELD) {
            continue;
        }
        if (selection.name.value !== rootFieldName) {
            continue;
        }
        return {
            responseKey: selection.alias?.value ?? selection.name.value,
            selectionSet: selection.selectionSet,
        };
    }
    return undefined;
}
function validateGraphQLSelection(descriptor, selectionSet, typeName = getGraphQLDescriptorTypeName(descriptor), seen = new Set()) {
    if (!selectionSet) {
        return [];
    }
    const normalized = unwrapGraphQLDescriptor(descriptor);
    if (normalized.kind === "list" && normalized.ofType) {
        return validateGraphQLSelection(normalized.ofType, selectionSet, typeName, seen);
    }
    if (normalized.kind === "scalar" || normalized.kind === "enum") {
        if (selectionSet.selections.length > 0) {
            return [`Field "${typeName}" does not have subfields.`];
        }
        return [];
    }
    if (normalized.kind !== "object" && normalized.kind !== "input-object") {
        return [];
    }
    if (seen.has(typeName)) {
        return [];
    }
    const nextSeen = new Set(seen);
    nextSeen.add(typeName);
    const errors = [];
    for (const selection of selectionSet.selections) {
        if (selection.kind !== Kind.FIELD) {
            errors.push("Fragments are not supported by the mock GraphQL server.");
            continue;
        }
        if (selection.name.value === "__typename") {
            continue;
        }
        const childDescriptor = normalized.fields?.[selection.name.value];
        if (!childDescriptor) {
            errors.push(`Cannot query field "${selection.name.value}" on type "${typeName}".`);
            continue;
        }
        if (!selection.selectionSet) {
            continue;
        }
        const childType = unwrapGraphQLDescriptor(childDescriptor);
        if (childType.kind === "scalar" || childType.kind === "enum") {
            errors.push(`Field "${selection.name.value}" of type "${getGraphQLDescriptorTypeName(childDescriptor)}" must not have a selection set.`);
            continue;
        }
        errors.push(...validateGraphQLSelection(childDescriptor, selection.selectionSet, getGraphQLDescriptorTypeName(childDescriptor), nextSeen));
    }
    return errors;
}
function pruneGraphQLResponseData(descriptor, value, selectionSet, seen = new Set()) {
    if (descriptor.kind === "non-null" && descriptor.ofType) {
        return pruneGraphQLResponseData(descriptor.ofType, value, selectionSet, seen);
    }
    if (descriptor.kind === "list" && descriptor.ofType) {
        if (!Array.isArray(value)) {
            return value;
        }
        return value.map(item => pruneGraphQLResponseData(descriptor.ofType, item, selectionSet, new Set(seen)));
    }
    if (descriptor.kind === "scalar" || descriptor.kind === "enum") {
        return value;
    }
    if ((descriptor.kind === "object" || descriptor.kind === "input-object") && isPlainObject(value)) {
        if (!selectionSet) {
            return value;
        }
        const typeName = descriptor.typeName.trim();
        if (typeName && seen.has(typeName)) {
            return selectionSet.selections.some(selection => selection.kind === Kind.FIELD && selection.name.value === "__typename")
                ? { __typename: typeName }
                : {};
        }
        const nextSeen = new Set(seen);
        if (typeName) {
            nextSeen.add(typeName);
        }
        const out = {};
        for (const selection of selectionSet.selections) {
            if (selection.kind !== Kind.FIELD) {
                continue;
            }
            const responseKey = selection.alias?.value ?? selection.name.value;
            if (selection.name.value === "__typename") {
                out[responseKey] = descriptor.typeName;
                continue;
            }
            const childDescriptor = descriptor.fields?.[selection.name.value];
            if (!childDescriptor) {
                continue;
            }
            const childValue = value[selection.name.value];
            out[responseKey] = pruneGraphQLResponseData(childDescriptor, childValue, selection.selectionSet, nextSeen);
        }
        return out;
    }
    return value;
}
export function buildGraphQLResponseDataForSelection(descriptor, requestBody, rootFieldName) {
    const selection = parseGraphQLSelection(requestBody, rootFieldName);
    const responseKey = selection?.responseKey ?? rootFieldName;
    const fullData = buildGraphQLResponseData(descriptor);
    if (!selection?.selectionSet) {
        return { responseKey, data: fullData };
    }
    const validationErrors = validateGraphQLSelection(descriptor, selection.selectionSet);
    if (validationErrors.length > 0) {
        return {
            responseKey,
            data: null,
            errors: validationErrors.map(message => ({ message })),
        };
    }
    return {
        responseKey,
        data: pruneGraphQLResponseData(descriptor, fullData, selection.selectionSet),
    };
}
//# sourceMappingURL=graphql.js.map