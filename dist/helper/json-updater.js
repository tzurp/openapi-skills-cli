import { promises as fsp } from "fs";
import path from "path";
import { logger } from "./logger.js";
import fs from 'fs-extra';
export async function loadJsonObject(filePath) {
    try {
        const content = await fs.readJSON(filePath, "utf8");
        return content;
    }
    catch (err) {
        if (err.code === "ENOENT") {
            return {};
        }
        throw err;
    }
}
function setDeep(obj, key, value) {
    const parts = key.split(".");
    let curr = obj;
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i] ?? "";
        const isLast = i === parts.length - 1;
        const isIndex = typeof part === "string" && /^[0-9]+$/.test(part);
        const idx = isIndex ? Number(part) : undefined;
        if (isLast) {
            if (isIndex && Array.isArray(curr) && idx !== undefined) {
                curr[idx] = value;
            }
            else {
                curr[part] = value;
            }
        }
        else {
            if (isIndex && idx !== undefined) {
                if (!Array.isArray(curr)) {
                    if (i > 0) {
                        const prev = parts[i - 1] ?? "";
                        curr[prev] = [];
                        curr = curr[prev];
                    }
                }
                if (!curr[idx])
                    curr[idx] = {};
                curr = curr[idx];
            }
            else {
                if (!(part in curr) || typeof curr[part] !== "object" || curr[part] === null)
                    curr[part] = {};
                curr = curr[part];
            }
        }
    }
}
export async function updateJsonFile(filePath, updates, space = 2) {
    let before = {};
    try {
        const content = await fsp.readFile(filePath, "utf8");
        before = JSON.parse(content);
    }
    catch (err) {
        if (err.code !== "ENOENT")
            throw err;
    }
    const after = JSON.parse(JSON.stringify(before));
    for (const [k, v] of Object.entries(updates)) {
        setDeep(after, k, v);
    }
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    if (!changed)
        return { changed: false, before, after };
    const abs = path.resolve(filePath);
    const dir = path.dirname(abs);
    const rand = Math.random().toString(36).slice(2, 10);
    const tmp = `${abs}.tmp.${process.pid}.${rand}`;
    let fh;
    const retryableCodes = new Set(["EPERM", "EACCES", "EBUSY"]);
    async function sleep(ms) {
        await new Promise(resolve => setTimeout(resolve, ms));
    }
    async function renameWithRetry(source, destination) {
        const attempts = 5;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                await fsp.rename(source, destination);
                return;
            }
            catch (err) {
                if (!retryableCodes.has(err?.code) || attempt === attempts) {
                    throw err;
                }
                await sleep(25 * attempt);
            }
        }
    }
    try {
        await fsp.mkdir(dir, { recursive: true });
        fh = await fsp.open(tmp, "w");
        await fh.writeFile(JSON.stringify(after, null, space), "utf8");
        await fh.sync();
        await fh.close();
        await renameWithRetry(tmp, abs);
        try {
            const dirFd = fs.openSync(dir, "r");
            fs.fsyncSync(dirFd);
            fs.closeSync(dirFd);
        }
        catch { }
        return { changed: true, before, after };
    }
    catch (err) {
        if (fh) {
            try {
                await fh.close();
            }
            catch { }
        }
        if (err.code === "EPERM" || err.code === "EACCES" || err.code === "EBUSY") {
            logger.error(`Failed to atomically update JSON file due to a file lock or permission error.\n` +
                `Please close any programs that may have the file open and try again.\n` +
                `The temporary file with your changes is: ${tmp}`);
        }
        throw err;
    }
}
//# sourceMappingURL=json-updater.js.map