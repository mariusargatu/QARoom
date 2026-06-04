/**
 * Screenplay pattern foundation (Milestone 5, ADR-0005). An Ability is a capability an Actor
 * holds — wrapping the browser, an API client, or an event stream. Abilities are the ONLY
 * place a concrete driver (Playwright `Page`, `fetch`, a WebSocket) is touched; Tasks and
 * Questions express intent in domain terms and reach the driver only through the Actor.
 */
export interface Ability {
  /** Unique key an Actor stores the ability under (e.g. `BrowseTheWeb`). */
  readonly name: string
}
