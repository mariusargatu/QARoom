# Spike 4 — Microcks-async WebSocket binding

- **Milestone affected:** 5 (WebSocket service virtualization)
- **Question:** Can Microcks-async serve a sample WebSocket AsyncAPI mock with
  Playwright-readable behavior?
- **Verdict:** ⚠️ **DEFERRED — not validated in the Milestone-0 time box** → ADR amendment
  (`docs/adr/0003-websocket-mock-strategy.md`).

## Method / findings

Confirmed both images are available and pullable:
`quay.io/microcks/microcks-uber:nightly` and
`quay.io/microcks/microcks-uber-async-minion:nightly`.

Serving a **WebSocket** AsyncAPI mock requires the async ensemble: the main Microcks
instance (config/import) **plus** the `async-minion` **plus** a broker the minion depends
on. Standing up and wiring that 3-container ensemble — importing a WS-binding AsyncAPI,
exposing the WS endpoint, then driving a browser through Playwright to read the pushed
frames — is disproportionate effort at Milestone 0 for a feature that does not land until
Milestone 5. It was therefore not fully validated here.

The fallback is low-risk by construction: Node 24 ships a global `WebSocket` client, and
`mock-socket` is a mature browser-side WS mock that Playwright assertions read directly.

## Consequence

Per exit criterion 9, this spike produces an ADR amendment rather than a feasibility
confirmation. Milestone 5 will start with the **`mock-socket`** fallback for WS mocking +
Playwright WS assertions + the polling-parity test (Commitment 11). Microcks-async WS is
re-evaluated during Milestone 5 — when the WebSocket feature, an async broker, and the
AsyncAPI WS binding actually exist — as an optional service-virtualization upgrade. See
`docs/adr/0003-websocket-mock-strategy.md`.
