/**
 * Request headers set by the proxy (src/proxy.ts) on every API request, so
 * that `handleApiError` can tell which route an unhandled error came from
 * (System health). Overwritten by the proxy: a client cannot choose them.
 */
export const ROUTE_HEADER = "x-hp-route";
export const METHOD_HEADER = "x-hp-method";
