# Inside the services (components + flows)

Four services get a C4 component breakdown — the ones whose internal shape carries the
architecture's load. Each maps to a view in [`views/structural.dsl`](../views/structural.dsl) and
to one file under [`model/components/`](../model/components). The other backends
(`identity`, `flags`, `donations`) follow the content template and are shown at container level
only. The boundary-to-technique map lives in [`ARCHITECTURE.md` §3](https://github.com/mariusargatu/QARoom/blob/main/ARCHITECTURE.md).

Edge convention: solid edges are sync (HTTP/SQL/in-proc), dashed are async (NATS).

## content-service — `ContentComponents`

The layered fleet template: every later backend copies this shape. The source is the map:
[`services/content/src/`](https://github.com/mariusargatu/QARoom/blob/main/services/content/src) and its co-located property tests.

| Component | Role |
|---|---|
| `routes` | Fastify handlers (posts/votes/feed). Parse params + body via Zod, wrap mutations in `withIdempotency`, emit RFC 7807, Zod-validate the response before sending. |
| `repository` | Advisory lock + `SELECT … FOR UPDATE`; domain write + outbox stage in one tx; `traced('db.*')` spans; `score = sum(votes)`. |
| `events` | Builds the Zod-validated `PostCreated` / `VoteCast` event and `outboxPublish`es it (subject + name + version + community + payload). |
| `contract registry` | The `OPERATIONS` list feeding `openapi.yaml` + `/system/capabilities` + the completeness test; AsyncAPI builder for the two events. |
| `config/faults` | The single boot-boundary read of the `CONTENT_BUG_*` / `CHAOS_*` toggles into an injected `FaultConfig` (kept `NODE_ENV`-token-free for the matrix census). |
| `db (schema/migrate)` | Drizzle tables + reversible migration fragments + the `community_id` backfill machine + the shared `@qaroom/messaging` substrate (outbox, `processed_events`, `idempotency_responses`). |
| `outbox relay` | `@qaroom/messaging`: drains committed outbox rows to NATS (`FOR UPDATE SKIP LOCKED`, at-least-once); re-enters the originating trace + tenant scope. |

Wiring: `routes → repository → events / contract / config-faults / db`; the `outbox relay` runs
beside them, reading the same `db` and publishing to NATS out of band.

**Create-post lifecycle** (`routes/posts.ts` → `repository/posts.ts`):

1. `CommunityId.parse(params)` + `CreatePostRequest.parse(body)` (`.strictObject`) — bad input is a 400 before any write.
2. `withIdempotency(…, 201)` — a replayed `Idempotency-Key` returns the original body from `idempotency_responses`, no re-exec.
3. One tx: `advisoryLock(id)` → `insert posts` → stage the outbox row (`publishPostCreated`) — atomic; the event commits with the domain write.
4. `lamport.bump()` — the tracked write advances the `as_of` gate.
5. `Post.parse(record)` — the response is validated through the *same* schema the spec is generated from, so wire and contract can't drift.

The relay drains the staged row to `qaroom.content.posts.{community_id}.created` out of band, so a
broker outage never loses the event (Commitment 17).

## gateway — `GatewayComponents`

The external trust boundary. Proxies every upstream over HTTP; owns no database.

| Component | Role |
|---|---|
| `proxy routes` | Per-domain route groups (content/identity/flags/donations/webhooks/moderation reads). Re-validate branded ids + `Idempotency-Key` at the edge; never trust the caller. |
| `rate limiter` | Per-IP + per-`X-Principal-Id` token bucket; 429 with `failure_domain: rate_limit`. In-memory, per-process. |
| `upstream clients` | Thin HTTP client per upstream over the bound caller; map upstream faults to 502. |
| `upstream-call` | Bounded HTTP caller with `AbortSignal` timeout (`GATEWAY_UPSTREAM_TIMEOUT_MS`). |
| `circuit-breaker` | Consecutive-failure breaker (cooldown + jitter from injected `Randomness`, half-open trial) guarding each upstream. |
| `ws-upgrade` | `/ws` handler. Validates a one-use 30s ticket (`Sec-WebSocket-Protocol`) against identity before upgrading ([ADR-0013](https://github.com/mariusargatu/QARoom/blob/main/docs/adr/0013-websocket-short-lived-ticket-auth.md)). |
| `event stream` | NATS consumer + per-community WebSocket feed; relays flag/donation changes as `WsEnvelope`s. A polling endpoint serves the same events (Commitment 11). |
| `jwks client` | Consumes identity's Pact-verified JWKS contract. |
| `operations registry` | Aggregates domain operations into `openapi.yaml` + `/system/capabilities` + `/system/limits`. |

Request path: `proxy routes` are throttled by the `rate limiter`, dispatch to an `upstream client`,
which calls over `upstream-call`, which is guarded by the `circuit-breaker`. The `event stream`
consumes domain events from NATS to drive the live WS feed; `ws-upgrade` and `jwks client` both
reach identity over HTTP.

The REST plane is **unauthenticated by design** — it redeems WS tickets and consumes the JWKS
contract but never decodes inbound JWTs; edge credentials are the parked Milestone 13. That rationale
is single-sourced, not re-derived here: see [ADR-0022](https://github.com/mariusargatu/QARoom/blob/main/docs/adr/0022-gateway-fronts-identity-and-moderation-for-the-web-edge.md) /
[`ARCHITECTURE.md` §7](https://github.com/mariusargatu/QARoom/blob/main/ARCHITECTURE.md#7-what-this-architecture-deliberately-omits-and-why).

## moderator-agent — `ModeratorComponents`

The one Python service: a retrieval-grounded RAG agent ([ADR-0018](https://github.com/mariusargatu/QARoom/blob/main/docs/adr/0018-moderator-agent-architecture.md),
[ADR-0020](https://github.com/mariusargatu/QARoom/blob/main/docs/adr/0020-moderator-rag-and-eval-stack.md)). The LangGraph nodes *are* the
components. It **proposes, it does not enforce**.

| Component | Role |
|---|---|
| `consumer` | Durable NATS consumer on `qaroom.content.posts.*.created` (cross-tenant wildcard, tenant-leak guarded). |
| `input + corpus guard` | Fences attacker-controlled post bodies *and* retrieved context as DATA (unforgeable delimiters) before the model sees them (`guard.py`). |
| `retrieve (node)` | Stage-1 retrieval: top-k policy corpus from pgvector via injected `Embedder` + `PolicyCorpusStore`. |
| `rerank (node)` | Stage-2 retrieval ([ADR-0021](https://github.com/mariusargatu/QARoom/blob/main/docs/adr/0021-separable-retrieval-components.md)): `LlmReranker` narrows candidates, grounding-guarded by `ground_order`, behind a `Reranker` port. |
| `gather_precedent (node)` | Fetches similar past decisions from the `KnowledgeStore` to ground the draft. |
| `draft (node)` | A single LLM call → citation-bearing `disposition ∈ {approve, remove, escalate_to_human}` + `cited_rules` / `precedents` / `departs_from_precedent` / `rationale` / `confidence`. |
| `self_check (node)` | Pure validation: grounding, precedent consistency, never-confidently-approve-flagged (escalate), abstain on low confidence. No failure edge. |
| `record (node)` | Persists the decision + citations; idempotent on `event_id`. |
| `publisher` | NATS publisher for `moderation.decision.recorded` (`Nats-Msg-Id` = stable decision `event_id`). |
| `tokenizer` | `Tokenizer` port (`TiktokenTokenizer` `cl100k_base` in prod, `WordTokenizer` fake). |
| `llm client` | Provider-agnostic `LlmClient` seam (LangChain `init_chat_model`); every call is a GenAI-semconv span. |
| `policy corpus store` / `knowledge store` / `decision store` | Per-community policy corpus + precedent index in pgvector; decisions + citations in Postgres (the `event_id`-UNIQUE idempotency table). |

Trajectory: `consumer → guard → retrieve → rerank → gather_precedent → draft → self_check → record →
publish`. The `tokenizer` and `llm client` are injected seams (fakes in tests). The four RAG
sub-components (`tokenizer`, `rerank`, `Embedder`/corpus, `knowledge`) are each separately testable
(ADR-0021). Idempotency comes from the LangGraph checkpointer keyed on `thread_id = event_id`, so a
redelivered `post.created` resumes rather than re-decides.

## webhooks — `WebhookComponents`

The outbound delivery edge ([ADR-0019](https://github.com/mariusargatu/QARoom/blob/main/docs/adr/0019-webhooks-as-a-tested-delivery-edge.md)): a
pure NATS consumer that publishes nothing (the recursion guard).

| Component | Role |
|---|---|
| `fan-out consumer` | Durable consumer (`webhooks-fanout`) of all five entity subjects (`post.created`, `vote.cast`, `flag.state.changed`, `donation.state.changed`, `moderation.decision.recorded`). Inserts one delivery row per active subscription; deduped via `processed_events` + a unique `(subscription, event)` index. |
| `repository` | Transactional mutation of subscriptions + deliveries; advisory lock; validates against the delivery machine. |
| `delivery worker` | Relay loop: claims due rows (`FOR UPDATE SKIP LOCKED`), drives the XState machine (emitting `xstate.transition` spans), signs + sends. Never sleeps; "due" is `clock.now()`-based. |
| `delivery machine` | Hand-authored `webhook-delivery` XState machine (`Pending`/`Delivering`/`Delivered`/`Retrying`/`Failed`/`DeadLettered`). The single authority on legal transitions; MBT-walked. |
| `sender` | Injected `WebhookSender` seam (prod `fetch` + `AbortController`; programmable test double). Signs with HMAC-SHA256, timestamp bound into the signature (replay defense). |
| `SSRF guard` | Subscription URL validation: public HTTPS only; rejects loopback / private / link-local. |
| `retry schedule` | Pure-function deterministic capped + jittered backoff from injected `Randomness` — "the hardest-to-test part made the easiest." |

The **delivery ledger is the at-least-once work queue** — there is no outbox, because webhooks emits
no events. The `fan-out consumer` writes one ledger row per matching subscription via the
`repository`; the `delivery worker` then claims due rows, walks the `delivery machine`, sends through
the `sender` (which checks the `SSRF guard` before the POST), and on failure schedules the next
attempt from the pure `retry schedule` or dead-letters.

## Dynamic flows

Four sequence views in [`views/structural.dsl`](../views/structural.dsl) trace a request across
boundaries. Each one exercises the testing technique that defends the boundary it crosses
(see [`ARCHITECTURE.md` §3](https://github.com/mariusargatu/QARoom/blob/main/ARCHITECTURE.md)).

| View | Sequence | Boundary + technique |
|---|---|---|
| `CreatePostFlow` | member → web → gateway → content (insert + stage outbox in one tx) → relay drains `post.created` → moderator + webhooks fan out → signed receiver delivery | Trust boundary (gateway edge validation / Schemathesis) into the async event boundary — transactional outbox (Commitment 17) + event message-Pact. |
| `ModerationTrajectory` | `post.created` → consumer → guard → retrieve → rerank → gather_precedent → draft (single LLM call) → self_check → record → publish `moderation.decision.recorded` | The LLM/agent boundary — LangGraph reverse-conformance (`xstate.transition` spans) + RAG/agentic evals + the prompt-injection guard (ADR-0020/0021). |
| `WebhookDelivery` | domain event → fan-out consumer → ledger row per subscription → worker claims due rows → delivery machine → signed sender → receiver; retry scheduled on failure | The outbound delivery edge — `webhook-delivery` XState MBT + reverse-conformance, the deterministic capped-jittered retry property, HMAC + SSRF (ADR-0019). |
| `FlagRollout` | moderatorUser → web → gateway → flags (transition) → publishes `flag.state.changed` → donations projects into `flag_cache`; gateway pushes a `WsEnvelope` to the live feed | The rollout state-machine boundary — MBT on the rollout machine + reverse-conformance, with WS/polling parity (Commitment 11) on the projection. |
