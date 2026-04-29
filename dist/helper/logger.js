export const isInteractive = process.stderr.isTTY && process.stdout.isTTY;
function writeStderr(message, newline) {
    process.stderr.write(newline ? `${message}\n` : message);
}
export const logger = {
    info(message) {
        writeStderr(message, true);
    },
    warn(message) {
        const prefix = "⚠️  ";
        if (isInteractive) {
            const colored = `\x1b[33m${prefix}${message}\x1b[0m`;
            writeStderr(colored, true);
        }
        else {
            writeStderr(prefix + message, true);
        }
    },
    error(message) {
        process.stderr.write(`❌  ${message}\n`);
    },
    progress(message) {
        if (!isInteractive) {
            return;
        }
        writeStderr(message, false);
    },
    progressLine(message) {
        if (!isInteractive) {
            return;
        }
        writeStderr(message, true);
    },
    result(data) {
        process.stdout.write(`${JSON.stringify(data)}\n`);
    },
};
//# sourceMappingURL=logger.js.map