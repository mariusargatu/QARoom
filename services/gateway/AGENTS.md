# gateway

The external-facing service (trust boundary). It fronts operations across **content, donations,
flags, webhooks, identity, and moderation reads** (the last two added by ADR-0022), plus the
per-community event feed (`listEvents`) and the ticket-authenticated WebSocket upgrade (`/ws`):
it validates at the edge, rate-limits, and proxies upstream over HTTP. Read the repo-root
`AGENTS.md` first.

## Endpoints

The full surface lives in `openapi.yaml`, generated from the operation registry. Read that (or
`/system/capabilities`), not a table here: a hand-maintained endpoint table is a rot vector.

## Where things live

- **Upstream clients:** `src/content-client.ts` (the original **Pact consumer**, Milestone 1c)
  plus `donations-client.ts`, `flags-client.ts`, `webhooks-client.ts`, `identity-client.ts`,
  `moderator-client.ts`, and `ticket-client.ts`, all over the shared `upstream-call.ts` ->
  `forward()` 502-mapping. `pacts/*.json` are the consumer contracts the TS providers verify;
  the consumer specs live in `tests/contracts/`. The Python moderator-agent reads are
  integration-tested, not pacted (ADR-0022).
- **Operation registry:** `src/operations.ts` (aggregating the per-domain
  `*-operations.ts` files): single source for `openapi.yaml` + capabilities.
- **Edge validation:** branded ids + `Idempotency-Key` parsed at the gateway so a malformed
  request gets an RFC 7807 400 *before any upstream call*: the trust-boundary demonstration
  (`gateway.spec.ts` asserts the upstream is never reached on a bad request). This is not mere
  defense-in-depth: content re-validates the same shapes independently, and *that* copy
  demonstrates provider-side conformance under Schemathesis. Upstream unreachable ⇒ 502
  `dependency_failure`.
- **Lamport:** the gateway keeps its OWN monotonic counter, bumped on each successful proxied
  *mutation*, so its `/system/*` `as_of` envelope is pinnable for MBT (Commitment 7). It is
  independent of content's counter: two lamports advance for one logical write *by design*.
  MBT (M5) and snapshot replay (M7) must not assume `gateway.lamport == content.lamport`.
- **Rate limiting:** `src/rate-limit.ts` (Milestone 1b): token bucket per-IP + per `X-Principal-Id`;
  429 ⇒ `failure_domain: rate_limit`, `retryable: true`.

## Boundaries this service owns

- **Trust boundary** (client -> gateway): Schemathesis fuzzing + RFC 7807 conformance.
- **Process boundary** (gateway -> each TS upstream): Pact v4 consumer contracts (`pacts/*.json`);
  each upstream verifies as provider.
- **Triangulation** (Commitment 3, docs/03 §6): three orthogonal checks, no two redundant:
  **Pact** = consumer ↔ real provider; **cross-check** = the pact ↔ content's published OpenAPI,
  shape only (`services/content/tests/pact-oas-crosscheck.spec.ts`); **Schemathesis** = spec ↔
  running implementation at the trust boundary.

## Commands

```bash
pnpm --filter @qaroom/gateway dev               # tsx watch (needs content reachable: CONTENT_BASE_URL)
pnpm --filter @qaroom/gateway test              # vitest
pnpm --filter @qaroom/gateway openapi:generate  # regenerate openapi.yaml from Zod + operations
```

## Limits

- The REST plane is **unauthenticated by design** (ADR-0022): the principal is the
  `X-Principal-Id` header (falls back to IP). Edge JWT enforcement is deliberately omitted; the
  gateway consumes identity's JWKS contract (`src/jwks-client.ts`) and redeems WS tickets, but
  never decodes tokens. Real edge credentials are the parked Milestone 13 (`ARCHITECTURE.md` §7),
  which would supersede ADR-0022.
- Rate-limit state is in-memory; the gateway is stateless otherwise (no database).
