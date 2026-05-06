export const MEDIUM_OUTPUT_MAX_BYTES = 50 * 1024;
export function getJsonOutputSize(artifact) {
    const text = JSON.stringify(artifact) ?? "";
    const sizeBytes = Buffer.byteLength(text, "utf8");
    return { text, sizeBytes };
}
//# sourceMappingURL=output-size.js.map