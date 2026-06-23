# ADR 0025: The gateway verifies access tokens at the edge to enforce membership on REST event reads

- **Status:** Accepted
- **Date:** 2026-06-23
- **Supersedes (in part):** ADR-0022's deferral of REST edge authentication to "Milestone 13". The
  **events polling read** (`GET /api/communities/:cid/events`) is no longer unauthenticated; the rest
  of the proxy surface remains as ADR-0022 left it (the broader edge-auth rollout is still future
  work). The note in `jwks-client.ts` that "the gateway never decodes tokens" is superseded for this
  one verifier.
- **Relates to:** ADR-0013 (WS handshake tickets — the membership control this brings to the polling
  twin), ADR-0008 (ES256 issuance), ADR-0022 (gateway-as-edge). Does **not** modify any ADR-0001
  commitment. No request/response shape changes (oasdiff stays clean): the change is a new
  precondition (a 401/403 where there was an unconditional 200), additive at the edge.

## Context

The WebSocket upgrade (`ws-upgrade.ts`) enforces ticket auth **and** community membership: a principal
who is not a member of the requested community is rejected with `403 ws-not-a-member`. Its polling
twin — the fallback that lets a WS-less client read the same envelopes (Commitment 11) — performed
**no** authentication or membership check. Any caller, authenticated or not, member or not, could read
any community's event stream. The "parity" the parity test asserts was therefore data-shape parity
(identical envelopes), **not** access-control parity: a live cross-tenant disclosure.

A max-effort review surfaced this. The gap had been tracked as a comment plus an `it.todo` marker and
deferred to "Milestone 13" on the reasoning that closing it "needs a REST edge-auth primitive: the
one-use WS ticket does not fit repeated polling." That reasoning is correct — but the primitive it
implies already exists in the system. identity issues an **ES256 JWT carrying the user's
`memberships`** (the same token the WS ticket is minted from), and the gateway already consumes
identity's **JWKS** through a bounded-timeout Pact-consumer client (`jwks-client.ts`). A JWT, unlike a
one-use ticket, is reusable — so it fits repeated polling.

## Decision

Give the gateway a small **edge token verifier** (`token-verifier.ts`) and enforce membership on the
polling read:

1. **Verify the bearer token at the edge.** `createTokenVerifier(jwks, clock)` reads
   `Authorization: Bearer <jwt>`, verifies the ES256 signature **locally** with `jose`
   (`createLocalJWKSet` over the JWKS fetched through the existing bounded-timeout client — never a
   raw fetch), checks `iss`/`exp` against the **injected Clock**, and returns the decoded
   `AccessTokenClaims`. A missing/invalid/expired token is an RFC 7807 **401**. The parsed JWKS is
   cached; a token signed by a rotated key (kid miss) triggers exactly one refetch-and-retry. No
   per-poll round-trip to identity.
2. **Enforce membership.** `events-routes.ts` requires the requested community to appear in the
   token's `memberships`, or refuses with **403 `not-a-member`** — the polling analogue of
   `ws-not-a-member`. Parity is now both data-shape **and** access-control.
3. **One source for the issuer.** `ACCESS_TOKEN_ISSUER` moves to `@qaroom/contracts`; identity signs
   with it and the gateway verifies against it (no duplicated security constant).
4. **Keep it falsifiable.** A deliberate-bug toggle `GATEWAY_BUG_SKIP_EVENTS_AUTHZ` skips the
   membership check (the cross-tenant leak), and the falsifiable claim `events-polling-membership`
   pins a gate that turns red when the toggle is set.

## Alternatives rejected

- **(a) Leave it deferred to M13.** Rejected: it is a live cross-tenant read, and the closing
  primitive already exists. Prose/`it.todo` tracks a gap but does not close it.
- **(b) Per-poll validation round-trip to identity.** Verify each poll by calling identity. Rejected:
  adds identity latency to every poll when the gateway can verify locally from the JWKS it already
  caches.
- **(c) A multi-use polling ticket.** A new reusable-ticket primitive in identity. Rejected: new
  server-side state and a new contract for what a JWT already carries.

## Consequences

- The gateway is now a **token-verifying edge** for this read, not a pure crypto-free proxy. That is
  the deliberate M13-shaped shift, scoped to one route; extending it to the other proxy routes remains
  future work and would supersede more of ADR-0022.
- `verifyToken` is a **required** gateway dependency (no silent fail-open). Tests inject a
  `tokenVerifierStub`; the real `jose` path is unit-tested in `token-verifier.test.ts`.
- Membership reflects the JWT snapshot at issuance — the same trust model the WS ticket already uses;
  no stronger freshness is claimed.
