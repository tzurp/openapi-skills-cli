import fs from "fs-extra";
import https from "https";
import os from "os";
import path from "path";
import { logger } from "./logger.js";
export async function checkForUpdateOncePerTerminalSession(currentVersion) {
    try {
        const sessionId = new Date().toISOString().slice(0, 10);
        const sessionFile = path.join(os.tmpdir(), `openapi-skills-session-${sessionId}`);
        if (fs.existsSync(sessionFile))
            return;
        fs.writeFileSync(sessionFile, String(Date.now()));
        const latestVersion = await new Promise((resolve, reject) => {
            https.get("https://registry.npmjs.org/@tzurp/openapi-skills/latest", res => {
                let data = "";
                res.on("data", chunk => (data += chunk));
                res.on("end", () => {
                    try {
                        const json = JSON.parse(data);
                        resolve(json.version);
                    }
                    catch (error) {
                        reject(error);
                    }
                });
            }).on("error", reject);
        });
        if (latestVersion && latestVersion !== currentVersion) {
            logger.warn(`UPDATE_AVAILABLE: A newer version of openapi-skills is available → ${latestVersion} (current: ${currentVersion})`);
            logger.warn("Update with: npm install -g @tzurp/openapi-skills");
        }
        logger.banner("💎  openapi-skills v2 is available — including mock APIs, HTML docs, schema diffing, code‑first tools, full OpenAPI 3.1 support, premium support, and additional Pro tools.\n    https://openapi-skills.lemonsqueezy.com/");
    }
    catch {
    }
}
//# sourceMappingURL=update-check.js.map