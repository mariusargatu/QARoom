# gateway

The external-facing service (trust boundary). It fronts content-service: validates at the
edge, rate-limits (Milestone 1b), and proxies posts/votes/feed to content over HTTP. Read the
repo-root `AGENTS.md` first.

## Endpoints

| Method | Path | operationId | Notes |
|---|---|---|---|
| POST | `/api/communities/{communityId}/posts` | `createPost` | mutating; `Idempotency-Key` required; proxied |
| GET | `/api/communities/{communityId}/feed` | `listCommunityFeed` | proxied |
| GET | `/api/posts/{postId}` | `getPost` | proxied |
| POST | `/api/posts/{postId}/votes` | `castVote` | mutating; `Idempotency-Key` required; proxied |
| GET | `/system/state` / `/system/capabilities` | - | observable state (Commitment 7) |
| GET | `/system/limits` | `getSystemLimits` | per-principal rate-limit usage (Milestone 1b) |

## Where things live

- **Content client:** `src/content-client.ts`: the **Pact consumer**. Milestone 1c consumer
  tests run it against a Pact mock and emit `pacts/*.json` for content to verify.
- **Operation registry:** `src/operations.ts`: single source for `openapi.yaml` + capabilities.
- **Edge validation:** branded ids + `Idempotency-Key` parsed at the gateway so a malformed
  request gets an RFC 7807 400 *before any upstream call*: the trust-boundary demonstration
  (`gateway.spec.ts` asserts the upstream is never reached on a bad request). This is not mere
  defense-in-depth: content re-validates the same shapes independently, and *that* copy
  demonstrates provider-side conformance under Schemathesis. Upstream unreachable ⇒ 502
  `dependency_failure`.
- **Lamport:** the gateway keeps its OWN monotonic counter, bumped on each successful proxied
  *mutation*, so its `/system/*` `as_of` envelope is pinnable for MBT (Commitment 7). It is
  independent of content's counter: two lamports advance for one logical write *by design*.
  Milestone 5 MBT / Milestone 7 replay must not assume `gateway.lamport == content.lamport`.
- **Rate limiting:** `src/rate-limit.ts` (Milestone 1b): token bucket per-IP + per `X-Principal-Id`;
  429 ⇒ `failure_domain: rate_limit`, `retryable: true`.

## Boundaries this service owns

- **Trust boundary** (client -> gateway): Schemathesis fuzzing + RFC 7807 conformance.
- **Process boundary** (gateway -> content): Pact v4 consumer contract; content verifies as provider.
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

## Limits (Milestone 1)

- No JWT yet: principal is the `X-Principal-Id` header (falls back to IP); swaps to the JWT
  `sub` claim in Milestone 2.
- Rate-limit state is in-memory (swappable for Redis later). Stateless otherwise; no database.
