import { type JSONValue } from "./json-updater.js";
export type JSONObject = Record<string, JSONValue>;
export declare function decodeBase64UrlJsonObject(input: string, optionName: string): JSONObject;
