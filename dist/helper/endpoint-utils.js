import { listEndpoints } from "../index.js";
import { filterEndpoints } from "./endpoint-filter.js";
export async function getSanitizedOperationId(apiName, operationId) {
    const options = { operationId };
    const endpoints = await listEndpoints(apiName);
    const found = filterEndpoints(endpoints, options)[0] ?? endpoints.find((endpoint) => endpoint.name === operationId);
    return found?.sanitizedOperationId ?? found?.operationId ?? found?.name ?? "";
}
export default getSanitizedOperationId;
//# sourceMappingURL=endpoint-utils.js.map