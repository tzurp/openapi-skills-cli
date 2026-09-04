import fs from "fs-extra";
import http from "http";
import path from "path";
import { spawn } from "child_process";
import { getDocsOutputDir, getProjectRoot } from "./paths.js";
export const DEFAULT_REDOC_URL = "https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js";
export async function openDocsInBrowser(url) {
    const platform = process.platform;
    let command;
    let args;
    if (platform === "darwin") {
        command = "open";
        args = [url];
    }
    else if (platform === "win32") {
        command = "cmd";
        args = ["/c", "start", "", url];
    }
    else {
        command = "xdg-open";
        args = [url];
    }
    await new Promise((resolve) => {
        try {
            const child = spawn(command, args, { detached: true, stdio: "ignore" });
            child.once("error", () => resolve());
            child.unref();
        }
        catch {
        }
        resolve();
    });
}
function toPosixPath(input) {
    return input.split(path.sep).join("/");
}
function getContentType(filePath) {
    switch (path.extname(filePath).toLowerCase()) {
        case ".html":
            return "text/html; charset=utf-8";
        case ".js":
            return "application/javascript; charset=utf-8";
        case ".css":
            return "text/css; charset=utf-8";
        case ".json":
            return "application/json; charset=utf-8";
        case ".yaml":
        case ".yml":
            return "text/yaml; charset=utf-8";
        case ".svg":
            return "image/svg+xml";
        default:
            return "application/octet-stream";
    }
}
function buildRedocAttributes(options) {
    const attrs = [];
    if (options.hideSidebar === true)
        attrs.push(`hide-sidebar="true"`);
    if (options.hideDownloadButtons === true)
        attrs.push(`hide-download-buttons="true"`);
    if (options.disableSearch === true)
        attrs.push(`disable-search="true"`);
    if (options.onlyRequiredInSamples === true)
        attrs.push(`only-required-in-samples="true"`);
    if (options.sortRequiredPropsFirst === true)
        attrs.push(`sort-required-props-first="true"`);
    if (options.showExtensions === true)
        attrs.push(`show-extensions="true"`);
    if (typeof options.scrollYOffset === "number")
        attrs.push(`scroll-y-offset="${options.scrollYOffset}"`);
    return attrs.join(" ");
}
function buildRedocThemeAttribute(isDark) {
    if (!isDark) {
        return undefined;
    }
    const theme = {
        sidebar: {
            backgroundColor: "#0f172a",
            textColor: "#e2e8f0",
            activeTextColor: "#7dd3fc",
        },
        rightPanel: {
            backgroundColor: "#020617",
            textColor: "#e2e8f0",
        },
        colors: {
            primary: {
                main: "#38bdf8",
            },
            text: {
                primary: "#f8fafc",
                secondary: "#cbd5e1",
                tertiary: "#94a3b8",
            },
            http: {
                get: "#22c55e",
                post: "#38bdf8",
                put: "#f59e0b",
                delete: "#ef4444",
            },
        },
        typography: {
            fontSize: "14px",
            lineHeight: "1.5em",
            textColor: "#e2e8f0",
            secondaryTextColor: "#cbd5e1",
            code: {
                backgroundColor: "rgba(15, 23, 42, 0.9)",
                color: "#e2e8f0",
            },
            headings: {
                color: "#f8fafc",
            },
            links: {
                color: "#7dd3fc",
                visited: "#60a5fa",
            },
        },
        codeBlock: {
            backgroundColor: "#020617",
            textColor: "#e2e8f0",
        },
    };
    return `theme='${JSON.stringify(theme)}'`;
}
function isHttpUrl(value) {
    try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    }
    catch {
        return false;
    }
}
function inferExtensionFromPathOrContent(input, contentType, body) {
    const extension = path.extname(input).toLowerCase();
    if (extension === ".json")
        return "json";
    if (extension === ".yaml" || extension === ".yml")
        return "yaml";
    if (contentType && /json/i.test(contentType))
        return "json";
    if (contentType && /(yaml|yml)/i.test(contentType))
        return "yaml";
    if (body !== undefined) {
        try {
            JSON.parse(body);
            return "json";
        }
        catch {
            return "yaml";
        }
    }
    return undefined;
}
export async function resolveDocsSchemaFile(schemaSourcePath) {
    if (isHttpUrl(schemaSourcePath)) {
        const response = await fetch(schemaSourcePath);
        if (!response.ok) {
            throw new Error(`Failed to download schema from ${schemaSourcePath}: ${response.status} ${response.statusText}`);
        }
        const body = await response.text();
        const extension = inferExtensionFromPathOrContent(schemaSourcePath, response.headers.get("content-type") ?? undefined, body);
        if (!extension) {
            throw new Error(`Unsupported schema file extension in URL: ${schemaSourcePath}`);
        }
        return {
            sourcePath: schemaSourcePath,
            sourceText: body,
            fileName: `schema.${extension}`,
            extension,
        };
    }
    const normalizedPath = path.resolve(getProjectRoot(), schemaSourcePath);
    if (!(await fs.pathExists(normalizedPath))) {
        throw new Error(`Schema file not found: ${schemaSourcePath}`);
    }
    const extension = inferExtensionFromPathOrContent(normalizedPath);
    if (!extension) {
        throw new Error(`Unsupported schema file extension: ${path.extname(normalizedPath) || "<none>"}`);
    }
    return {
        sourcePath: normalizedPath,
        fileName: `schema.${extension}`,
        extension,
    };
}
export async function ensureRedocStandaloneAsset(redocUrl = process.env.OPENAPI_SKILLS_REDOC_URL ?? DEFAULT_REDOC_URL) {
    return redocUrl;
}
export function buildDocsHtml(options) {
    const specUrl = `./${toPosixPath(options.schemaFileName)}`;
    const title = options.title;
    const redocAttributes = buildRedocAttributes({
        hideSidebar: options.hideSidebar,
        hideDownloadButtons: options.hideDownloadButtons,
        disableSearch: options.disableSearch,
        onlyRequiredInSamples: options.onlyRequiredInSamples,
        sortRequiredPropsFirst: options.sortRequiredPropsFirst,
        showExtensions: options.showExtensions,
        scrollYOffset: options.scrollYOffset,
    });
    const redocThemeAttribute = buildRedocThemeAttribute(options.dark === true);
    const rootClass = options.dark === true ? ' class="dark"' : "";
    const darkStyles = options.dark === true ? [
        "    <style>",
        "      :root.dark {",
        "        --bg-color: #0f172a;",
        "        --text-color: #e2e8f0;",
        "        --text-color-primary: #f8fafc;",
        "        --text-color-secondary: #e2e8f0;",
        "        --text-color-description: #cbd5e1;",
        "        --text-color-helper: #cbd5e1;",
        "        --text-color-disabled: #94a3b8;",
        "        --text-color-on-color: #f8fafc;",
        "        --link-text-color: #7dd3fc;",
        "        --h1-text-color: #f8fafc;",
        "        --h2-text-color: #f8fafc;",
        "        --h3-text-color: #f8fafc;",
        "        --h4-text-color: #f8fafc;",
        "        --h5-text-color: #f8fafc;",
        "        --h6-text-color: #f8fafc;",
        "        --sidebar-background-color: #111827;",
        "        --sidebar-active-background-color: #1f2937;",
        "        --navbar-bg-color: #0b1220;",
        "        --content-background-color: #0f172a;",
        "      }",
        "      html.dark, html.dark body {",
        "        background-color: #0f172a;",
        "        color: #e2e8f0;",
        "        color-scheme: dark;",
        "      }",
        "      html.dark redoc h1,",
        "      html.dark redoc h2,",
        "      html.dark redoc h3,",
        "      html.dark redoc h4,",
        "      html.dark redoc h5,",
        "      html.dark redoc h6,",
        "      html.dark redoc .markdown p,",
        "      html.dark redoc .markdown li {",
        "        color: #e2e8f0;",
        "      }",
        "      html.dark redoc .markdown small,",
        "      html.dark redoc .markdown .muted,",
        "      html.dark redoc .markdown .summary,",
        "      html.dark redoc .markdown .section-header {",
        "        color: #cbd5e1;",
        "      }",
        "      html.dark redoc span {",
        "        color: #e2e8f0 !important;",
        "      }",
        "      html.dark redoc {",
        "        display: block;",
        "        min-height: 100vh;",
        "      }",
        "    </style>",
    ].join("\n") : "";
    return [
        "<!DOCTYPE html>",
        `<html${rootClass}>`,
        "  <head>",
        '    <meta charset="utf-8"/>',
        '    <meta name="viewport" content="width=device-width, initial-scale=1"/>',
        `    <title>${title}</title>`,
        "    <style>",
        "      body { margin: 0; padding: 0; }",
        "    </style>",
        darkStyles,
        "  </head>",
        "  <body>",
        `    <redoc spec-url="${specUrl}"${redocAttributes ? ` ${redocAttributes}` : ""}${redocThemeAttribute ? ` ${redocThemeAttribute}` : ""}></redoc>`,
        `    <script src="${options.redocUrl}"></script>`,
        "  </body>",
        "</html>",
        "",
    ].join("\n");
}
export async function generateDocsSite(options) {
    const projectRoot = getProjectRoot();
    const schemaFile = await resolveDocsSchemaFile(options.schemaSourcePath);
    const resolvedSourcePath = isHttpUrl(options.schemaSourcePath)
        ? new URL(options.schemaSourcePath).pathname
        : path.resolve(projectRoot, options.schemaSourcePath);
    const schemaName = typeof options.rename === "string" && options.rename.trim().length > 0
        ? options.rename.trim()
        : path.parse(resolvedSourcePath).name;
    const outDir = path.resolve(projectRoot, options.outDir ?? getDocsOutputDir(schemaName));
    const redocUrl = await ensureRedocStandaloneAsset(options.redocUrl);
    const schemaPath = path.join(outDir, schemaFile.fileName);
    const indexPath = path.join(outDir, "index.html");
    await fs.ensureDir(outDir);
    if (schemaFile.sourceText !== undefined) {
        await fs.writeFile(schemaPath, schemaFile.sourceText);
    }
    else {
        await fs.copyFile(schemaFile.sourcePath, schemaPath);
    }
    await fs.writeFile(indexPath, buildDocsHtml({
        title: `${schemaName} API Docs`,
        schemaFileName: schemaFile.fileName,
        redocUrl,
        dark: options.dark,
        hideSidebar: options.hideSidebar,
        hideDownloadButtons: options.hideDownloadButtons,
        disableSearch: options.disableSearch,
        onlyRequiredInSamples: options.onlyRequiredInSamples,
        sortRequiredPropsFirst: options.sortRequiredPropsFirst,
        showExtensions: options.showExtensions,
        scrollYOffset: options.scrollYOffset,
    }));
    return {
        schemaName,
        outDir,
        indexPath,
        schemaPath,
        schemaFileName: schemaFile.fileName,
    };
}
export async function serveDocs(outDir, port = 8000) {
    const resolvedOutDir = path.resolve(getProjectRoot(), outDir);
    const server = http.createServer(async (req, res) => {
        try {
            const requestPath = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
            const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
            const filePath = path.resolve(resolvedOutDir, relativePath);
            const normalizedOutDir = path.resolve(resolvedOutDir);
            if (filePath !== normalizedOutDir && !filePath.startsWith(`${normalizedOutDir}${path.sep}`)) {
                res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
                res.end("Forbidden");
                return;
            }
            const data = await fs.readFile(filePath);
            res.writeHead(200, { "content-type": getContentType(filePath) });
            res.end(data);
        }
        catch {
            res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
            res.end("Not found");
        }
    });
    const listenPort = await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                reject(new Error("Failed to determine the docs server port."));
                return;
            }
            resolve(address.port);
        });
    });
    return {
        server,
        port: listenPort,
        url: `http://127.0.0.1:${listenPort}/index.html`,
    };
}
//# sourceMappingURL=docs.js.map