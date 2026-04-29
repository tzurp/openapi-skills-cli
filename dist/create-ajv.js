import Ajv from "ajv";
import draft4 from "../assets/schema-draft-04.json" with { type: "json" };
export function createAjv() {
    const ajv = new Ajv({
        strict: false,
        strictSchema: false,
        allErrors: true,
        allowUnknownKeywords: true,
    });
    ajv.addMetaSchema(draft4);
    return ajv;
}
//# sourceMappingURL=create-ajv.js.map