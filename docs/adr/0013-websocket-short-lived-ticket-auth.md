# ADR 0013 — WebSocket authentication via short-lived one-use tickets

- **Status:** Accepted
- **Date:** 2026-06-04
- **Records:** how a browser authenticates a WebSocket connection to the gateway (Milestone 5).
  Complements [ADR-0003](0003-websocket-mock-strategy.md) (how WS is *tested*) — this is how WS
  is *authenticated* in production. Does **not** modify any ADR-0001 commitment.

## Context

The browser holds a JWT access token but cannot set an `Authorization` header on a WebSocket
handshake (the browser WS API forbids custom headers). The two common workarounds each leak: a
token in the query string lands in access logs and browser history; a long-lived bearer token in
the `Sec-WebSocket-Protocol` subprotocol leaks into proxy/server access logs. The gateway also
needs to authorize the connection to a specific community before upgrading.

## Decision

A **short-lived, one-use ticket** exchanged for the JWT:

1. **Mint** — the client calls `POST /ws/tickets` on identity-service with its Bearer JWT.
   Identity verifies the token and returns a `tkt_<ulid>` valid for **30 seconds**, bound to the
   principal (user id + memberships), held in an in-memory store (Redis in a later milestone).
   The endpoint is deliberately **not** idempotent — each call mints a fresh ticket.
2. **Present** — the client opens `GET /ws?community=<id>` with
   `Sec-WebSocket-Protocol: ticket.<ticket>`.
3. **Validate before upgrade** — the gateway, in a `preValidation` hook that runs *before* the
   protocol upgrade, redeems the ticket via identity's internal `POST /ws/tickets/redeem`
   (server-to-server, consuming it exactly once) and checks the principal is a member of the
   requested community. A missing/malformed subprotocol, an unknown/expired/replayed ticket, or
   a non-member fails the **HTTP handshake** with an RFC 7807 401/403 — the socket is never
   upgraded.

The ticket carries no signed claims: it is a lookup key into a server-side store, useless after
its single redemption or 30-second expiry. The leak window is ≤30s and one-use, versus a
long-lived credential.

## Consequences

### Positive

- No long-lived credential ever appears in a WS URL, subprotocol, or access log.
- Authorization (community membership) is enforced at the handshake, before any frame flows.
- Expiry and one-use are driven by the injected `Clock`, so both are deterministically testable
  (advance a FakeClock; replay a redeemed ticket) — see `identity/tests/ws-tickets.spec.ts`.

### Negative / trade-offs accepted

- An extra round-trip (mint, then connect) and an internal gateway→identity redeem call.
- The Milestone-5 store is in-memory: tickets do not survive an identity restart (acceptable for
  a ≤30s artifact) and do not work across identity replicas until Redis lands.
- Polling clients (the Commitment-11 fallback) do not use tickets; the gateway's polling endpoint
  is open in Milestone 5 (the gateway has no JWT middleware yet) — documented, hardened later.

## Rejected alternatives

- **Bearer JWT in the subprotocol.** Leaks a long-lived credential into proxy/server logs.
- **Token in the query string.** Leaks into access logs and browser history.
- **A signed short-lived JWT as the ticket.** Works without a server-side store, but cannot be
  made truly one-use without a revocation list — the in-memory store gives one-use for free.

## Related decisions

- [ADR-0003](0003-websocket-mock-strategy.md) (WS testing), [ADR-0008](0008-jwt-signing-key-model-and-rotation-contract.md)
  (JWT model), `docs/04-roadmap.md` Milestone 5 (Commitment 11 polling parity).
