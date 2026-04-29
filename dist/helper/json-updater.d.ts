export type JSONValue = string | number | boolean | null | JSONObject | JSONArray;
export interface JSONObject {
    [k: string]: JSONValue;
}
export interface JSONArray extends Array<JSONValue> {
}
export type Updates = Record<string, JSONValue>;
export declare function loadJsonObject(filePath: string): Promise<any>;
export declare function updateJsonFile(filePath: string, updates: Updates, space?: number | string): Promise<{
    changed: boolean;
    before: any;
    after: any;
}>;
//# sourceMappingURL=json-updater.d.ts.map