import * as fs from "node:fs/promises";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import { getProjectRoot } from "./helper/paths.js";
import { logger } from "./helper/logger.js";
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
function renderBoolean(value) {
    return value ? "Yes" : "No";
}
function renderDescription(description) {
    return Array.isArray(description) ? description.join("\n") : description;
}
function renderCommandSection(agentMeta) {
    const argumentsMarkdown = agentMeta.arguments.length > 0
        ? agentMeta.arguments.map(argument => {
            const parts = [argument.type, argument.required ? "required" : "optional"];
            if (argument.positional)
                parts.push("positional");
            if (argument.flag)
                parts.push("flag");
            const description = argument.description ? `: ${argument.description}` : "";
            const flagPrefix = argument.flag ? "--" : "";
            const name = argument.positional ? argument.name : `${flagPrefix}${argument.name}`;
            return `- \`${name}\` (${parts.join(", ")})${description}`;
        }).join("\n")
        : "- None";
    const examplesMarkdown = agentMeta.examples.length > 0
        ? agentMeta.examples.map(example => `- \`\`\`bash\n${example}\n\`\`\``).join("\n")
        : "- None";
    const filesWrittenMarkdown = agentMeta.filesWritten.length > 0
        ? agentMeta.filesWritten.map(file => `\`${file}\``).join(", ")
        : "None";
    return [
        `### ${agentMeta.name}`,
        "",
        `**Category:** ${agentMeta.category}`,
        "",
        `**Usage:**`,
        "```bash",
        agentMeta.usage,
        "```",
        "",
        `**Description:** ${renderDescription(agentMeta.description)}`,
        "",
        `**Arguments:**`,
        argumentsMarkdown,
        "",
        `**Examples:**`,
        examplesMarkdown,
        "",
        `**Returns:** ${agentMeta.returns.type} - ${agentMeta.returns.description}`,
        "",
        `**Side Effects:** Writes Files: ${renderBoolean(agentMeta.sideEffects.writesFiles)}, Reads Files: ${renderBoolean(agentMeta.sideEffects.readsFiles)}, Network: ${renderBoolean(agentMeta.sideEffects.network)}`,
        "",
        `**Constraints:** Destructive: ${renderBoolean(agentMeta.constraints.destructive)}, Idempotent: ${renderBoolean(agentMeta.constraints.idempotent)}, Requires Parsed API: ${renderBoolean(agentMeta.constraints.requiresParsedApi)}`,
        "",
        `**Files Written:** ${filesWrittenMarkdown}`,
    ].join("\n");
}
async function getCommandReferenceMarkdown() {
    const { program } = await import("./cli.js");
    const commands = program.commands;
    const agentCommands = commands
        .filter((command) => Boolean(command.agentMeta))
        .filter(command => command.agentMeta.name !== "help" && command.agentMeta.name !== "install");
    return agentCommands.map(command => renderCommandSection(command.agentMeta)).join("\n\n");
}
export async function promptInstallLocation(defaultPath) {
    const homeDir = getProjectRoot();
    const menu = [
        { label: `~/.claude/skills/openapi-skills`, value: path.join(homeDir, ".claude", "skills", "openapi-skills") },
        { label: `~/.agents/skills/openapi-skills`, value: path.join(homeDir, ".agents", "skills", "openapi-skills") },
        { label: "Other (enter a custom path)", value: "__custom__" }
    ];
    function ask(question) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
        return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
    }
    logger.info("Select install location:");
    menu.forEach((item, idx) => {
        logger.info(`  ${idx + 1}) ${item.label}`);
    });
    let choice;
    while (true) {
        choice = await ask(`Enter number (1-${menu.length}): `);
        const idx = parseInt(choice, 10) - 1;
        if (!isNaN(idx) && idx >= 0 && idx < menu.length && menu[idx]) {
            if (menu[idx].value === "__custom__") {
                const customPath = await ask(`Enter custom install path [${defaultPath}]: `);
                return customPath.trim() || defaultPath;
            }
            return menu[idx].value;
        }
        logger.warn(`Invalid selection. Please enter a number between 1 and ${menu.length}.`);
    }
}
async function copySkillTemplate(templateName, outputPath, transform) {
    const templatePath = path.join(moduleDir, "../skill-templates", templateName);
    try {
        const contents = await fs.readFile(templatePath, "utf8");
        const renderedContents = transform ? await transform(contents) : contents;
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, renderedContents, "utf8");
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to copy skill template "${templateName}" from "${templatePath}" to "${outputPath}": ${errorMessage}`, { cause: error instanceof Error ? error : undefined });
    }
}
export async function installSkillBundle(srcDir, destDir) {
    await fs.mkdir(destDir, { recursive: true });
    const referencesDest = path.join(destDir, "references");
    await fs.mkdir(referencesDest, { recursive: true });
    const files = [
        { templateName: "SKILL.md", outputPath: path.join(destDir, "SKILL.md") },
        { templateName: "write-client-code.md", outputPath: path.join(referencesDest, "write-client-code.md") },
        { templateName: "create-endpoint-test.md", outputPath: path.join(referencesDest, "create-endpoint-test.md") },
        { templateName: "http-client.md", outputPath: path.join(referencesDest, "http-client.md") }
    ];
    for (const file of files) {
        if (file.templateName === "SKILL.md") {
            await copySkillTemplate(file.templateName, file.outputPath, async (contents) => {
                const commandReference = await getCommandReferenceMarkdown();
                if (!contents.includes("<command-list-here>")) {
                    throw new Error("SKILL.md template is missing <command-list-here>.");
                }
                return contents.replace("<command-list-here>", commandReference);
            });
            continue;
        }
        await copySkillTemplate(file.templateName, file.outputPath);
    }
    return {
        destDir,
        files: files.map(file => file.outputPath)
    };
}
//# sourceMappingURL=install-skill.js.map