export declare function promptInstallLocation(rootDir: string, defaultPath: string): Promise<string>;
export declare function installSkillBundle(srcDir: string, destDir: string): Promise<{
    destDir: string;
    files: string[];
}>;
