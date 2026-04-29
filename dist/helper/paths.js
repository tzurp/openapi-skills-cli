import path from "path";
import findRoot from "find-root";
const projectRoot = getProjectRoot();
export function getSchemaPath(apiName, schemaName) {
    const schemasDir = getSchemasDir(apiName);
    return path.join(schemasDir, `${schemaName}.json`);
}
export function getBundledPath(apiName) {
    return path.resolve(projectRoot, ".openapi-skills", apiName, "bundled.json");
}
export function getComponentsPath(apiName) {
    return path.resolve(projectRoot, ".openapi-skills", apiName, "components.json");
}
export function findRequestResponseDir(apiName, sanitizedOperationId) {
    const schemasDir = getSchemasDir(apiName);
    return path.resolve(schemasDir, sanitizedOperationId);
}
export function getSchemasDir(apiName) {
    return path.resolve(projectRoot, ".openapi-skills", apiName, "schemas");
}
export function getApiDir(apiName) {
    return path.resolve(projectRoot, ".openapi-skills", apiName);
}
export function getConfigPath() {
    return path.resolve(projectRoot, ".openapi-skills", "config.json");
}
export function getEndpointsPath(apiName) {
    return path.resolve(projectRoot, ".openapi-skills", apiName, "endpoints.json");
}
export function getOpenapiToSkillsDir() {
    return path.resolve(projectRoot, ".openapi-skills");
}
export function getProjectRoot() {
    const cwd = process.cwd();
    try {
        return findRoot(cwd);
    }
    catch {
        return cwd;
    }
}
//# sourceMappingURL=paths.js.map