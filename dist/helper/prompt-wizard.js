import readline from "readline";
import fs from "fs-extra";
import { getOperationArtifactPath } from "../helper/paths.js";
import { getSanitizedOperationId } from "../helper/endpoint-utils.js";
import { collectRequestJsonPaths } from "./request-artifacts.js";
import { updateJsonFile } from "./json-updater.js";
function question(prompt) {
    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
        rl.question(prompt, answer => {
            rl.close();
            resolve(answer ?? "");
        });
    });
}
function setDeep(obj, key, value) {
    const parts = key.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i] ?? "";
        const isLast = i === parts.length - 1;
        const idx = /^[0-9]+$/.test(part) ? Number(part) : null;
        if (isLast) {
            if (idx !== null && Array.isArray(cur))
                cur[idx] = value;
            else
                cur[part] = value;
        }
        else {
            if (idx !== null) {
                const prev = parts[i - 1] ?? "0";
                if (!Array.isArray(cur))
                    cur = (cur[prev] = []);
                if (!cur[idx])
                    cur[idx] = {};
                cur = cur[idx];
            }
            else {
                if (!cur[part] || typeof cur[part] !== "object")
                    cur[part] = {};
                cur = cur[part];
            }
        }
    }
}
export async function interactiveRequestFlow(apiName, operationId) {
    const sanitized = await getSanitizedOperationId(apiName, operationId);
    const requestPath = getOperationArtifactPath(apiName, sanitized, "request");
    let requestJson = {};
    try {
        requestJson = await fs.readJson(requestPath);
    }
    catch {
        requestJson = {};
    }
    const keys = collectRequestJsonPaths(requestJson);
    const pending = {};
    while (true) {
        const choice = (await question(`\nInteractive request helper for ${operationId} — choose: (l)ist keys, (e)dit key, (p)review, (a)pply, (r)un request, (q)uit: `)).trim().toLowerCase();
        if (choice === "l" || choice === "list") {
            console.error("Available keys (sample):");
            const sample = Array.from(keys).slice(0, 200);
            for (const k of sample)
                console.error(` - ${k}`);
            if (keys.size > sample.length)
                console.error(`... and ${keys.size - sample.length} more keys`);
            continue;
        }
        if (choice === "e" || choice === "edit") {
            const key = (await question("Key to edit: ")).trim();
            if (!key) {
                console.error("No key provided");
                continue;
            }
            if (!keys.has(key))
                console.error("Warning: key not present in request.json (you can still add it, but it's recommended to use existing keys).");
            const raw = (await question("New value (JSON): ")).trim();
            try {
                const parsed = JSON.parse(raw);
                pending[key] = parsed;
                console.error(`Staged: ${key} -> ${JSON.stringify(parsed)}`);
            }
            catch (err) {
                console.error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
            }
            continue;
        }
        if (choice === "p" || choice === "preview") {
            const before = JSON.parse(JSON.stringify(requestJson));
            const after = JSON.parse(JSON.stringify(before));
            for (const [k, v] of Object.entries(pending))
                setDeep(after, k, v);
            console.error("--- before ---");
            console.error(JSON.stringify(before, null, 2));
            console.error("--- after (preview) ---");
            console.error(JSON.stringify(after, null, 2));
            continue;
        }
        if (choice === "a" || choice === "apply") {
            if (Object.keys(pending).length === 0) {
                console.error("No pending updates to apply");
                continue;
            }
            try {
                const { changed } = await updateJsonFile(requestPath, pending);
                if (changed)
                    console.error("Applied updates to request.json");
                else
                    console.error("No changes detected");
                requestJson = await fs.readJson(requestPath);
                for (const k of Object.keys(pending))
                    keys.add(k);
                Object.keys(pending).forEach(k => delete pending[k]);
            }
            catch (err) {
                console.error(`Failed to apply updates: ${err instanceof Error ? err.message : String(err)}`);
            }
            continue;
        }
        if (choice === "r" || choice === "run") {
            if (Object.keys(pending).length > 0)
                return pending;
            return undefined;
        }
        if (choice === "q" || choice === "quit")
            return undefined;
        console.error("Unknown command — use l/e/p/a/r/q");
    }
}
export async function interactiveGetOperationFlow(apiName, operationId, artifactName) {
    const sanitized = await getSanitizedOperationId(apiName, operationId);
    const artifactPath = getOperationArtifactPath(apiName, sanitized, artifactName);
    if (!(await fs.pathExists(artifactPath))) {
        console.error(`Artifact not found: ${artifactName}`);
        return;
    }
    const show = (await question("Show artifact content? (y/N) ")).trim().toLowerCase();
    if (show === "y" || show === "yes") {
        try {
            const content = await fs.readJson(artifactPath);
            console.error(JSON.stringify(content, null, 2));
        }
        catch (err) {
            console.error(`Failed to read artifact: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
//# sourceMappingURL=prompt-wizard.js.map