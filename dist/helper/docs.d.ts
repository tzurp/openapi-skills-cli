import http from "http";
export declare const DEFAULT_REDOC_URL = "https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js";
export type DocsSchemaFile = {
    sourcePath: string;
    sourceText?: string;
    fileName: string;
    extension: "yaml" | "json";
};
export type ServeDocsResult = {
    server: http.Server;
    url: string;
    port: number;
};
export declare function openDocsInBrowser(url: string): Promise<void>;
export declare function resolveDocsSchemaFile(schemaSourcePath: string): Promise<DocsSchemaFile>;
export declare function ensureRedocStandaloneAsset(redocUrl?: string): Promise<string>;
export declare function buildDocsHtml(options: {
    title: string;
    schemaFileName: string;
    redocUrl: string;
    dark?: boolean;
    hideSidebar?: boolean;
    hideDownloadButtons?: boolean;
    disableSearch?: boolean;
    onlyRequiredInSamples?: boolean;
    sortRequiredPropsFirst?: boolean;
    showExtensions?: boolean;
    scrollYOffset?: number;
}): string;
export declare function generateDocsSite(options: {
    schemaSourcePath: string;
    rename?: string;
    outDir?: string;
    redocUrl?: string;
    dark?: boolean;
    hideSidebar?: boolean;
    hideDownloadButtons?: boolean;
    disableSearch?: boolean;
    onlyRequiredInSamples?: boolean;
    sortRequiredPropsFirst?: boolean;
    showExtensions?: boolean;
    scrollYOffset?: number;
}): Promise<{
    schemaName: string;
    outDir: string;
    indexPath: string;
    schemaPath: string;
    schemaFileName: string;
}>;
export declare function serveDocs(outDir: string, port?: number): Promise<ServeDocsResult>;
