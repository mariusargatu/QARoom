import type { Actor } from './actor'

/**
 * A Task is a unit of business intent an Actor performs (e.g. `advanceRollout`,
 * `castDonation`). It composes lower-level interactions. A Task that touches the browser MUST
 * do so through `actor.withPageProvider().getPage()` so the same source runs as E2E and as a
 * component test (ADR-0005).
 */
export interface Task {
  performAs(actor: Actor): Promise<void>
}
