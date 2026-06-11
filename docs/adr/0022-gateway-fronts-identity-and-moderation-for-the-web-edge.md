# ADR 0022: Gateway fronts identity + moderation reads for the web edge

- **Status:** Accepted
- **Date:** 2026-06-07
- **Implemented:** post-Milestone 12 (gateway + web frontend)
- **Relates to:** ADR-0013 (WS handshake tickets), ADR-0018 (the moderator proposes, never
  enforces), ADR-0006 (the MCP tool surface). Adds passthrough routes to the gateway so the browser
  can reach identity-service (user/community/membership bootstrap, session issuance, WS-ticket
  minting) and the moderator-agent decision reads (same-origin through `qaroom.localhost`). Does
  **not** modify any ADR-0001 commitment. All new routes are **additive** (no existing path
  changes), so oasdiff stays clean and the MCP manifest only widens.
- **Records:** the decision to expose existing-but-unreachable backend capability at the public
  edge for the web frontend, rather than (a) inventing new domain functionality, (b) giving each
  upstream its own ingress host, or (c) shipping a frontend that can only render a slice of the
  platform.

## Context

The web frontend talks to one origin: `qaroom.localhost`, where Traefik routes `/api` + `/ws` to
the gateway and `/` to the web app (`deploy/ingress.yaml`). The gateway proxied content, donations,
flags, webhooks, events, and system, but **not** identity-service or the moderator-agent, and
neither has an ingress host. A "full" frontend (identity picker, communities, member admin,
moderation dashboard, real WebSocket push) was therefore impossible to build against the real
backend even though every capability already existed: identity-service has shipped users/sessions/
JWKS/WS-tickets since Milestone 2, and the moderator-agent has exposed decision reads since
Milestone 12. The gap was purely at the edge.

Three options were considered. (a) **Invent nothing, ship a partial UI**: honest but defeats the
goal. (b) **Expose each service via its own ingress host**: multiplies origins, forces CORS, and
leaks internal services to the browser. (c) **Thin gateway passthrough**: the gateway already is
the edge; it already redeems WS tickets against identity internally (`ticket-client.ts`). Extending
it is the smallest change that keeps one origin, no CORS, and one validated front door.

## Decision

Add passthrough routes to the gateway, following the existing upstream-client pattern
(`flags-client.ts` over `upstreamCall` -> `forward()` 502-mapping):

- **identity** (`identity-client.ts` / `identity-routes.ts` / `identity-operations.ts`):
  `createUser`, `getUser`, `createCommunity`, `addMembership`, `listMembers`, `createSession`,
  `createWsTicket`. `createWsTicket` forwards the caller's `Authorization` header verbatim (the
  one new capability of `upstreamCall`: an optional `authorization` field), and identity verifies
  the JWT against its own JWKS. The gateway never decodes the token.
- **moderation** (`moderator-client.ts` / `moderation-routes.ts` / `moderation-operations.ts`):
  `listModerationDecisions`, `getModerationDecision`. Read-only: the agent proposes, never
  enforces (ADR-0018). A read-model `ModerationDecision`/`ModerationDecisionList` Zod schema is
  added to `@qaroom/contracts` (mirrors the agent's Pydantic `ModerationDecision`; the REST read
  uses `created_at` where the event uses `occurred_at`). The cross-language gate pins only the
  *event* schema, so this projection is additive.

The 9 operations register in the single `OPERATIONS` array, so `openapi.yaml` and
`/system/capabilities` both pick them up; the 4 new GET reads (`getUser`, `listMembers`, the two
moderation reads) auto-join the MCP tool surface (widening, non-breaking).

### Testing

- Gateway route integration tests cover every new route (passthrough, edge-400 on malformed ids,
  502 on unreachable upstream, Authorization-forwarding for WS tickets).
- The gateway->identity **Pact** grows from JWKS-only to the bootstrap/session surface, with
  matching provider state handlers in identity, verified against a real Postgres.
- Moderation reads are **integration-tested at the gateway only**: the moderator-agent is Python
  and not a Pact provider. `createWsTicket` is likewise integration-tested, not pacted: a recorded
  interaction cannot supply a live ES256-signed bearer (mirrors the long-standing un-pacted
  ticket-*redeem* path).

## Consequences

- **Security, stated plainly.** The gateway REST plane is **unauthenticated by design**:
  Milestone 2 deliberately deferred credentials (issuance, not authentication, is the tested
  surface). Proxying `createUser` + `createSession` at the public edge therefore makes
  impersonation trivial: anyone can mint a session for any user id. This is an accepted property
  of a **demo** platform, not a hidden vulnerability. It is called out here so a future reader does
  not mistake the demo identity boundary for a production auth boundary. The web frontend's
  "identity picker" reflects this honestly (pick/create an identity; no password). The rate limiter
  and the webhooks SSRF guard are unaffected.
- **Blast radius.** The gateway OpenAPI, `/system/capabilities`, the committed MCP manifest, and
  the golden transcript all move; all regenerated and gate-verified. No frozen release spec
  changes; oasdiff reports no breaking change.
- **Not a new commitment.** This is edge plumbing for existing functionality. If credentials are
  ever introduced, they belong at this same edge and supersede the security note above.
