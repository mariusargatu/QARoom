# QARoom: Code Tour

Docs `01`–`05` argue the thesis: *every boundary has a categorical failure mode and a named testing technique that defends it.* This document makes it concrete. It follows **one request**, `POST /api/communities/{id}/posts`, from the client edge to Postgres, and at each hop names the boundary it crosses and the technique that guards it, with `file:line` anchors you can click.

Read this after `01-vision.md` if you want the *idea*, or first if you want the *code*.

## Entry points: what to open per service

| Service | Boot | App wiring | Routes | Contract surface |
|---|---|---|---|---|
| `gateway` | `services/gateway/src/server.ts` | `services/gateway/src/app.ts:22` | `services/gateway/src/proxy-routes.ts` | `services/gateway/src/operations.ts` |
| `content` | `services/content/src/server.ts` | `services/content/src/app.ts:23` | `services/content/src/posts.ts` · `votes.ts` · `feed.ts` | `services/content/src/operations.ts` |
| shared | - | `packages/service-kit` (RFC 7807, `/system/*`) | - | `packages/contracts` (Zod = source of truth) |

Both `app.ts` files read the same shape: build a Fastify instance purely from injected `deps` (no globals: Commitment 6), register the problem handler, register routes, register `/system/*`. Read one and you've read both.

## The trace: one create-post, hop by hop

A client `POST`s a new post. The gateway fronts content-service; content owns the data. Each row is a boundary crossing.

| # | What happens | Code | Boundary | Technique that defends it |
|---|---|---|---|---|
| 1 | Request hits the gateway; per-principal token bucket consumed; over-limit -> 429 `rate_limit` problem | `services/gateway/src/rate-limit.ts:17` · bucket `rate-limiter.ts` | trust boundary | property test `rate-limiter.property.test.ts` (capacity never exceeded) |
| 2 | Gateway validates at the edge: brands the path id, parses the body | `proxy-routes.ts:40` (`CommunityId.parse`) · `:42` (`CreatePostRequest.parse`) | trust boundary | **Schemathesis** fuzzes the gateway OAS; **RFC 7807** conformance |
| 3 | Gateway forwards to content via the Pact-consumer client; unreachable upstream -> 502 `dependency_failure` | `proxy-routes.ts:43` -> `content-client.ts:46` · 502 map `proxy-routes.ts:14` | process boundary (REST) | **Pact v4** consumer test `tests/contracts/content.consumer.spec.ts:101` emits `pacts/gateway-content.json` |
| 4 | Gateway bumps its own lamport on a successful mutation | `proxy-routes.ts:30` | observability | `/system/state` `as_of` envelope |
| 5 | Content handler brands the id, parses the body, hashes it for idempotency | `services/content/src/posts.ts:14-17` | - | branded IDs enforced at runtime via Zod (`packages/contracts/src/ids.ts:19`) |
| 6 | Idempotency-Key replay check: same key + body -> stored response, no re-execute | `posts.ts:19-23` · store `repository.ts:138` · hash `idempotency.ts:18` | - | property test `services/content/src/idempotency.property.test.ts` |
| 7 | Write under single-writer discipline: advisory lock -> insert -> one row, one mapper | `repository.ts:53` (`createPost`) · lock `repository.ts:37` | persistence | advisory lock + `SELECT … FOR UPDATE` (Commitment 4) |
| 8 | Every tracked write funnels through the lamport gate | `repository.ts` `deps.lamport.bump()` -> `packages/contracts/src/lamport.ts:55` | observability | `/system/state` is pinnable by `snapshot_id` |
| 9 | Response re-parsed through the `Post` contract before send | `posts.ts:31` (`Post.parse`) | - | the response cannot drift from the schema |
| 10 | A community's posts never leak to another community | data partition (`community_id`) | tenancy boundary | **fast-check** property `services/content/src/tenancy.property.test.ts` |
| - | The gateway pact is verified against a *real* content + Postgres | `services/content/tests/contracts/provider.verify.ts` | process boundary (provider side) | **Pact** provider verification (Testcontainers) |

Any non-2xx along the way is an RFC 7807 `application/problem+json` with `retryable` / `next_actions` / `failure_domain`: see `posts.ts:47` (404) and `proxy-routes.ts:18` (502). The single handler is `packages/service-kit/src/problem.ts`.

### The determinism trio is everywhere on this path

`createPost` never calls the clock, a UUID lib, or `Math.random` directly. It reads `deps.clock.now()` and `deps.ids.next('post')` (`repository.ts:53`). Production wires real implementations (`packages/determinism/src/production/`); tests wire seeded ones (`packages/testing-utils/src/determinism/`). This is the precondition for replay and property testing, and a direct `new Date()` in non-test code fails lint (`tools/eslint-plugin-qaroom`).

## One schema, four derivations

The most teachable property: **the Zod schema is the single source of truth, and everything else derives from it.** `ProblemDetails` (`packages/contracts/src/errors.ts:38`) and its closed `FailureDomain` enum (`errors.ts:11`) feed four artifacts, none re-declares the shape:

| Derivation | Where | How it derives |
|---|---|---|
| Runtime error | `errors.ts:69` `makeProblem()` | `.parse()`-validates every problem the services emit |
| OAS example | `packages/contracts/src/openapi/params.ts` `problemResponse()` | built via `makeProblem()`, so the spec example is the same validated shape |
| Property generator | `packages/testing-utils/src/generators/problem.ts` | `fc.constantFrom(...FailureDomain.options)`: a new domain flows in automatically |
| Test matcher | `packages/testing-utils/src/matchers/rfc7807.ts` | `expectRFC7807` parses through `ProblemDetails` |

Change the contract and all four move together; a stale derivation fails loudly, not silently. The same pattern holds for branded IDs: `brandedIdPattern()` (`ids.ts:19`) is the one regex the runtime parser **and** the OAS path-param schema share, so Schemathesis can never fuzz an alphabet the parser disagrees with.

## The drift gates (triangulation)

No contract artifact is generated from another such that one edit silently changes both. Four independent checks disagree loudly:

| Gate | Direction it checks | Code |
|---|---|---|
| Zod -> OpenAPI round-trip | generated YAML == committed YAML | `services/*/tests/openapi-roundtrip.spec.ts` · builder `packages/contracts/src/openapi/builder.ts` |
| `oasdiff` | OpenAPI *was* vs *now* (no undeclared breaking change) | `scripts/openapi-verify.ts` |
| Pact ↔ OpenAPI cross-check | consumer's pact ⊆ published spec | `packages/testing-utils/src/contract-crosscheck/index.ts` · test `services/content/tests/pact-oas-crosscheck.spec.ts` |
| Zod ↔ OAS round-trip property | Zod and emitted JSON Schema accept/reject identically | `packages/testing-utils/src/generators/roundtrip.property.test.ts` |

Each gate is designed to *fail loudly* on real drift; that is what makes the triangulation credible rather than decorative.
