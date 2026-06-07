# ADR 0003: Milestone 5 WebSocket mock: start with `mock-socket`, treat Microcks-async as optional

- **Status:** Accepted (provisional: revisit at Milestone 5 Microcks-async validation)
- **Date:** 2026-05-29
- **Amends:** The Milestone 5 roadmap entry (WebSocket push + service virtualization) and the
  WebSocket-boundary row of the testing-technique table in `docs/02-architecture.md`. Does
  not supersede any ADR-0001 commitment (Commitment 11 is unchanged).
- **Provenance:** spike 4 **deferred** the Microcks-async WS evaluation under the Milestone-0
  time box; it did **not** refute it. This decision is therefore provisional: it sets a
  low-risk default, not a final rejection of Microcks-async.

## Context

Milestone 0 spike 4 (`docs/spikes/04-microcks-async-ws.md`) evaluated whether Microcks-async
can serve a WebSocket AsyncAPI mock that Playwright can read. The Microcks images are
available, but serving a WS binding requires a 3-container async ensemble (Microcks +
async-minion + broker). Validating that end-to-end, including a Playwright WS read, is
disproportionate at Milestone 0 for a Milestone-5 feature and was not completed in the time box.

## Decision

Milestone 5's WebSocket testing starts with the spike's pre-approved fallback:

1. **`mock-socket`** for browser-side WebSocket mocking in component/E2E tests.
2. **Playwright WS assertions** against the live WS endpoint for the real server-push path.
3. The **polling-parity test** (Commitment 11): every WS-delivered event is also asserted
   retrievable via the polling endpoint, so the two paths cannot drift.

Microcks-async WS is **optional**, revisited during Milestone 5 once the WebSocket feature, an
async broker, and the AsyncAPI WS binding exist. If validated then, it becomes the
service-virtualization layer; if not, `mock-socket` remains the approach.

## Consequences

- Milestone 5 does not block on Microcks-async; the WS testing story is de-risked via
  `mock-socket` + Playwright + polling parity.
- The AsyncAPI WS contract (Commitment 3) is still authored and drift-gated regardless of
  which mock serves it.
- Revisiting Microcks-async in Milestone 5 is a scoped spike, not a prerequisite.

**On acceptance:** apply the two declared amendments: update the WebSocket-boundary row in
`docs/02-architecture.md` and the Milestone 5 entry in `docs/04-roadmap.md` to name `mock-socket`
as the default and Microcks-async as the optional upgrade. (Not yet applied; this ADR is
still Proposed.)
