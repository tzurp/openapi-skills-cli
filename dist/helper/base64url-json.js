function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function decodeBase64UrlJsonObject(input, optionName) {
    if (typeof input !== "string" || input.trim().length === 0) {
        throw new Error(`${optionName} must be a non-empty base64url string.`);
    }
    let decoded;
    try {
        decoded = Buffer.from(input, "base64url").toString("utf8");
    }
    catch {
        throw new Error(`${optionName} must be valid base64url-encoded JSON.`);
    }
    let parsed;
    try {
        parsed = JSON.parse(decoded);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${optionName} decoded value must be valid JSON: ${message}`);
    }
    if (!isObject(parsed)) {
        throw new Error(`${optionName} decoded value must be a JSON object.`);
    }
    return parsed;
}
//# sourceMappingURL=base64url-json.js.map