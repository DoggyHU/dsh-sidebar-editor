/**
 * The HTTP routes this plugin's two halves share.
 *
 * Both must sit under `/api`, because that prefix route is the one that runs
 * Connection's trust fence and browser-cookie admission before dispatching. The
 * host half registers each path in Connection's exact Fetch-route table
 * (`connection.fetch.register`); the browser half calls it with a plain
 * same-origin `fetch`, which is authenticated exactly like the rest of the UI.
 *
 * `connection.rpc.handle` is unusable in this build — see the host half's `apply`
 * for the mechanism and what it costs to discover that the hard way.
 */
export const ROUTE_PREFIX = '/api/dsh-sidebar-milkdown';

/**
 * The URL of one endpoint.
 * @param endpoint - `ping` | `probe` | `open` | `save` | `report` | `diag`.
 * @returns the absolute path to POST to.
 */
export function endpointUrl(endpoint) {
  return `${ROUTE_PREFIX}/${endpoint}`;
}
