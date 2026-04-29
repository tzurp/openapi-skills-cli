import { readFile } from "fs/promises";
import path from "path";
import fs from "fs-extra";
import { updateJsonFile } from "./helper/json-updater.js";
import { getApiDir, getConfigPath, getEndpointsPath, getOpenapiToSkillsDir } from "./helper/paths.js";
const openapiSkillsDir = getOpenapiToSkillsDir();
const configPath = getConfigPath();
export async function loadConfig() {
    return await fs.readJSON(configPath);
}
export async function ensureConfig() {
    await fs.ensureDir(openapiSkillsDir);
    if (!(await fs.pathExists(configPath))) {
        const defaultConfig = {
            apis: {}
        };
        await fs.writeJson(configPath, defaultConfig, { spaces: 2 });
    }
}
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export async function updateConfig(apiName, options = {}) {
    if (typeof apiName !== "string" || apiName.trim().length === 0) {
        throw new Error("API name is required.");
    }
    const { baseUrl, auth, vars, version, openapiSource, removeApi } = options;
    const updates = {};
    if (removeApi) {
        if (!(await fs.pathExists(configPath))) {
            throw new Error("Config file not found.");
        }
        const config = await loadConfig();
        if (!isPlainObject(config) || !isPlainObject(config.apis)) {
            throw new Error("Invalid config file.");
        }
        if (!(apiName in config.apis)) {
            throw new Error(`API '${apiName}' not found`);
        }
        delete config.apis[apiName];
        await fs.writeJson(configPath, config, { spaces: 2 });
        return;
    }
    await ensureConfig();
    if (auth !== undefined) {
        updates[`apis.${apiName}.auth.headers`] = auth;
    }
    if (vars !== undefined) {
        for (const [key, value] of Object.entries(vars)) {
            updates[`apis.${apiName}.vars.${key}`] = value;
        }
    }
    if (version !== undefined) {
        updates[`apis.${apiName}.version`] = version;
    }
    if (openapiSource !== undefined) {
        let normalizedOpenapiSource = openapiSource;
        try {
            new URL(openapiSource);
        }
        catch {
            normalizedOpenapiSource = path.normalize(openapiSource);
        }
        updates[`apis.${apiName}.openapiSource`] = normalizedOpenapiSource;
    }
    if (baseUrl !== undefined) {
        updates[`apis.${apiName}.baseUrl`] = baseUrl;
    }
    if (Object.keys(updates).length === 0)
        return;
    await updateJsonFile(configPath, updates, 2);
}
function toDeleteApiError(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/config/i.test(message)) {
        return { type: "ConfigError", message };
    }
    if (/permission|EACCES|EPERM/i.test(message)) {
        return { type: "DirectoryDeletionError", message };
    }
    return { type: "DeleteApiError", message };
}
export async function deleteApi(apiName) {
    if (typeof apiName !== "string" || apiName.trim().length === 0) {
        return {
            ok: false,
            error: { type: "InvalidApiName", message: "API name is required." },
        };
    }
    try {
        const apiNames = await listApis();
        if (!apiNames.includes(apiName)) {
            return {
                ok: false,
                error: { type: "ApiNotFound", message: `API '${apiName}' is not installed.` },
            };
        }
        await updateConfig(apiName, { removeApi: true });
        const apiDir = getApiDir(apiName);
        await fs.remove(apiDir);
        return {
            ok: true,
            message: `API ${apiName} removed successfully`,
            data: { removedApi: apiName },
        };
    }
    catch (error) {
        return {
            ok: false,
            error: toDeleteApiError(error),
        };
    }
}
export async function getConfigValue(apiName, key) {
    const config = await loadConfig();
    const api = config.apis[apiName];
    if (!api) {
        throw new Error(`API '${apiName}' not found`);
    }
    switch (key) {
        case "version":
            return api.version ?? "unknown";
        case "baseUrl":
            return api.baseUrl;
        case "authHeaders":
            return api.auth?.headers ?? {};
        case "vars":
            return Object.entries(api.vars ?? {});
    }
}
export async function listEndpoints(apiName) {
    try {
        const endpoints = await readFile(getEndpointsPath(apiName), "utf-8");
        return JSON.parse(endpoints);
    }
    catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error(`Failed to parse endpoints.json: Invalid JSON format. ${error.message}`);
        }
        else {
            throw new Error(`Failed to read endpoints.json: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
export async function listApis() {
    const config = await loadConfig();
    return Object.keys(config.apis) || [];
}
//# sourceMappingURL=index.js.map