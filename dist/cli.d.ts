import { Command } from "commander";
declare module "commander" {
    interface Command {
        agentMeta?: {
            name: string;
            category: string;
            usage: string;
            description: string;
            arguments: Array<{
                name: string;
                type: string;
                required: boolean;
                positional?: boolean;
                flag?: boolean;
                description?: string;
            }>;
            returns: {
                type: string;
                description: string;
            };
            sideEffects: {
                writesFiles: boolean;
                readsFiles: boolean;
                network: boolean;
            };
            constraints: {
                destructive: boolean;
                idempotent: boolean;
                requiresParsedApi: boolean;
            };
            examples: string[];
            filesWritten: string[];
        };
    }
}
declare const program: Command;
export { program };
//# sourceMappingURL=cli.d.ts.map