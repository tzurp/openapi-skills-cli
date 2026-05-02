import readline from "readline";
export async function promptDeleteConfirmation(apiName) {
    const prompt = `Are you sure you want to delete ${apiName}? Y/n `;
    return await new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
        rl.question(prompt, answer => {
            rl.close();
            const normalized = answer.trim().toLowerCase();
            resolve(normalized === "y" || normalized === "yes");
        });
    });
}
//# sourceMappingURL=prompt-delete.js.map