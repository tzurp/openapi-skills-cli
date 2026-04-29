import { listEndpoints } from "../index.js";
import { filterEndpoints } from "./endpoint-filter.js";
export async function getSanitizedOperationId(apiName, operationId) {
    const options = { operationId };
    const endpoints = await listEndpoints(apiName);
    const found = filterEndpoints(endpoints, options)[0];
    return found?.sanitizedOperationId ?? found?.operationId ?? "";
}
export default getSanitizedOperationId;
//# sourceMappingURL=endpoint-utils.js.map