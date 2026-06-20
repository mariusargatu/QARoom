# QARoom: Code Tour

`ARCHITECTURE.md` argues the thesis: *every boundary has a categorical failure mode and a named testing technique that defends it.* This document makes it concrete. It follows **one request**, `POST /api/communities/{id}/posts`, from the client edge to Postgres, and at each hop names the boundary it crosses and the technique that guards it, with `file:line` anchors you can click.

Read this after `ARCHITECTURE.md` if you want the *idea*, or first if you want the *code*.

## Entry points: what to open per service

- **gateway**: boot [`server.ts`](../services/gateway/src/server.ts); wiring [`app.ts:30`](../services/gateway/src/app.ts#L30) (`buildGatewayApp`); routes [`proxy-routes.ts`](../services/gateway/src/proxy-routes.ts); contract surface [`operations.ts`](../services/gateway/src/operations.ts)
- **content**: boot [`server.ts`](../services/content/src/server.ts); wiring [`app.ts:22`](../services/content/src/app.ts#L22) (`buildApp`); routes [`routes/posts.ts`](../services/content/src/routes/posts.ts) · [`routes/votes.ts`](../services/content/src/routes/votes.ts) · [`routes/feed.ts`](../services/content/src/routes/feed.ts); contract surface [`contract/operations.ts`](../services/content/src/contract/operations.ts)
- **shared**: [`packages/service-kit`](../packages/service-kit) (RFC 7807, `/system/*`); [`packages/contracts`](../packages/contracts) (Zod = source of truth)

Both `app.ts` files read the same shape: build a Fastify instance purely from injected `deps` (no globals: Commitment 6), register the problem handler, register routes, register `/system/*`. Read one and you've read both.

## The trace: one create-post, hop by hop

A client `POST`s a new post. The gateway fronts content-service; content owns the data. Each hop is a boundary crossing.

1. **trust boundary** · Request hits the gateway; a per-principal token bucket is consumed; over-limit -> 429 `rate_limit` problem.
   - code: [`rate-limit.ts:23`](../services/gateway/src/rate-limit.ts#L23) (`limiter.consume`); the bucket is [`rate-limiter.ts:28`](../services/gateway/src/rate-limiter.ts#L28) (`RateLimiter`)
   - technique: **property test** [`rate-limiter.property.test.ts:11`](../services/gateway/src/rate-limiter.property.test.ts#L11) (`never allows more than capacity requests`)
2. **trust boundary** · The gateway validates at the edge: brands the path id, parses the body.
   - code: [`proxy-routes.ts:17`](../services/gateway/src/proxy-routes.ts#L17) (`CommunityId.parse`); [`proxy-routes.ts:19`](../services/gateway/src/proxy-routes.ts#L19) (`CreatePostRequest.parse`)
   - technique: **Schemathesis** fuzzes the gateway OAS ([`schemathesis-gate.sh`](../scripts/schemathesis-gate.sh)); **RFC 7807** conformance via [`rfc7807.ts:17`](../packages/testing-utils/src/matchers/rfc7807.ts#L17) (`expectRFC7807`)
3. **process boundary (REST)** · The gateway forwards to content via the Pact-consumer client; an unreachable upstream becomes a 502 `dependency_failure`.
   - code: [`proxy-routes.ts:21`](../services/gateway/src/proxy-routes.ts#L21) (`deps.content.createPost`) -> [`content-client.ts:26`](../services/gateway/src/content-client.ts#L26) (`createPost`); 502 map [`forward.ts:29`](../services/gateway/src/forward.ts#L29) (`problem`)
   - technique: **Pact v4** consumer test [`content.consumer.spec.ts:101`](../services/gateway/tests/contracts/content.consumer.spec.ts#L101) (`creates a post`) emits `pacts/gateway-content.json`
4. **observability** · The gateway bumps its own lamport on a successful mutation.
   - code: [`forward.ts:41`](../services/gateway/src/forward.ts#L41) (`deps.lamport.bump`)
   - technique: **`/system/state`** `as_of` envelope
5. **trust boundary (content edge)** · The content handler re-brands the id and re-parses the body; it does not trust the gateway.
   - code: [`routes/posts.ts:13`](../services/content/src/routes/posts.ts#L13) (`CommunityId.parse`); [`routes/posts.ts:14`](../services/content/src/routes/posts.ts#L14) (`CreatePostRequest.parse`)
   - technique: **branded IDs** enforced at runtime via Zod, [`ids.ts:19`](../packages/contracts/src/ids.ts#L19) (`brandedIdPattern`)
6. **retry boundary** · Idempotency-Key replay check: same key + body -> stored response, no re-execute. The replay dance lives in one shared wrapper in `@qaroom/service-kit`.
   - code: [`routes/posts.ts:15`](../services/content/src/routes/posts.ts#L15) (`withIdempotency`) -> [`idempotency.ts:32`](../packages/service-kit/src/idempotency.ts#L32) (`withIdempotency`); hash [`idempotency.ts:39`](../packages/service-kit/src/idempotency.ts#L39) (`bodyHash`); store [`idempotency.ts:60`](../packages/service-kit/src/idempotency.ts#L60) (`storeIdempotent`)
   - technique: **property test** [`idempotency.property.test.ts:9`](../services/content/src/idempotency.property.test.ts#L9) (`same Idempotency-Key`)
7. **persistence** · Write under single-writer discipline: advisory lock -> insert -> one row, one mapper.
   - code: [`repository/posts.ts:39`](../services/content/src/repository/posts.ts#L39) (`createPost`); lock [`repository/posts.ts:57`](../services/content/src/repository/posts.ts#L57) (`advisoryLock`)
   - technique: **advisory lock + `SELECT … FOR UPDATE`** (Commitment 4); property test [`single-writer.property.test.ts:27`](../services/content/src/single-writer.property.test.ts#L27) (`whatever the interleaving`)
8. **observability** · Every tracked write funnels through the lamport gate.
   - code: [`repository/posts.ts:61`](../services/content/src/repository/posts.ts#L61) (`deps.lamport.bump`) -> [`lamport.ts:55`](../packages/contracts/src/lamport.ts#L55) (`bump`)
   - technique: **`/system/state`** is pinnable by `snapshot_id`
9. **contract boundary** · The response is re-parsed through the `Post` contract before send.
   - code: [`routes/posts.ts:26`](../services/content/src/routes/posts.ts#L26) (`Post.parse`)
   - technique: **contract re-parse**: the response cannot drift from the schema
10. **tenancy boundary** · A community's posts never leak to another community.
    - code: data partition (`community_id`)
    - technique: **fast-check** property [`tenancy.property.test.ts:36`](../services/content/src/tenancy.property.test.ts#L36) (`only in their own feed`)
11. **process boundary (provider side)** · The gateway pact is verified against a *real* content + Postgres.
    - code: [`provider.verify.ts:13`](../services/content/tests/contracts/provider.verify.ts#L13) (`runProviderVerification`)
    - technique: **Pact** provider verification (Testcontainers)

Any non-2xx along the way is an RFC 7807 `application/problem+json` with `retryable` / `next_actions` / `failure_domain`: see the 404 at [`routes/posts.ts:36`](../services/content/src/routes/posts.ts#L36) (`problem`) and the 502 at [`forward.ts:29`](../services/gateway/src/forward.ts#L29) (`problem`). The single handler is [`problem.ts`](../packages/service-kit/src/problem.ts).

### The determinism trio is everywhere on this path

`createPost` never calls the clock, a UUID lib, or `Math.random` directly. It reads the injected trio: [`repository/posts.ts:48`](../services/content/src/repository/posts.ts#L48) (`deps.ids.next`) and [`repository/posts.ts:54`](../services/content/src/repository/posts.ts#L54) (`deps.clock.now`). Production wires real implementations ([`packages/determinism/src/production/`](../packages/determinism/src/production)); tests wire seeded ones ([`packages/testing-utils/src/determinism/`](../packages/testing-utils/src/determinism)). This is the precondition for replay and property testing, and a direct `new Date()` in non-test code fails lint ([`tools/eslint-plugin-qaroom`](../tools/eslint-plugin-qaroom)).

## One schema, four derivations

The most teachable property: **the Zod schema is the single source of truth, and everything else derives from it.** The problem shape is [`errors.ts:38`](../packages/contracts/src/errors.ts#L38) (`ProblemDetails`); its closed failure-domain enum is [`errors.ts:11`](../packages/contracts/src/errors.ts#L11) (`FailureDomain`). They feed four artifacts; none re-declares the shape:

| Derivation | Where | How it derives |
|---|---|---|
| Runtime error | [`errors.ts:69`](../packages/contracts/src/errors.ts#L69) (`makeProblem`) | `.parse()`-validates every problem the services emit |
| OAS example | [`params.ts:45`](../packages/contracts/src/openapi/params.ts#L45) (`problemResponse`) | built via `makeProblem()`, so the spec example is the same validated shape |
| Property generator | [`problem.ts:12`](../packages/testing-utils/src/generators/problem.ts#L12) (`fc.constantFrom`) | `fc.constantFrom(...FailureDomain.options)`: a new domain flows in automatically |
| Test matcher | [`rfc7807.ts:17`](../packages/testing-utils/src/matchers/rfc7807.ts#L17) (`expectRFC7807`) | `expectRFC7807` parses through `ProblemDetails` |

Change the contract and all four move together; a stale derivation fails loudly, not silently. The same pattern holds for branded IDs: [`ids.ts:19`](../packages/contracts/src/ids.ts#L19) (`brandedIdPattern`) is the one regex the runtime parser **and** the OAS path-param schema share, so Schemathesis can never fuzz an alphabet the parser disagrees with.

## The drift gates (triangulation)

No contract artifact is generated from another such that one edit silently changes both. Four independent checks disagree loudly:

| Gate | Direction it checks | Code |
|---|---|---|
| Zod -> OpenAPI round-trip | generated YAML == committed YAML | [`openapi-roundtrip.spec.ts`](../services/content/tests/openapi-roundtrip.spec.ts) (one per service) · builder [`builder.ts`](../packages/contracts/src/openapi/builder.ts) |
| `oasdiff` | OpenAPI *was* vs *now* (no undeclared breaking change) | [`openapi-verify.ts`](../scripts/openapi-verify.ts) |
| Pact <-> OpenAPI cross-check | consumer's pact ⊆ published spec | [`contract-crosscheck/index.ts`](../packages/testing-utils/src/contract-crosscheck/index.ts) · test [`pact-oas-crosscheck.spec.ts`](../services/content/tests/pact-oas-crosscheck.spec.ts) |
| Zod <-> OAS round-trip property | Zod and emitted JSON Schema accept/reject identically | [`roundtrip.property.test.ts`](../packages/testing-utils/src/generators/roundtrip.property.test.ts) |

Each gate is designed to *fail loudly* on real drift; that is what makes the triangulation credible rather than decorative.
