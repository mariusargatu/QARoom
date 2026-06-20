# ADR 0018: The moderator-agent: a Python LLM service on the QARoom substrate

- **Status:** Accepted
- **Date:** 2026-06-04
- **Records:** the *architecture* decisions for QARoom's first (and, per ADR-0001, only) Python
  service: toolchain, the moderation action seam, where community rules live, the deliberate dedup
  asymmetry vs the TS services, the cross-language contract discipline, and how it deploys on the
  shared substrate. Records *implementation* decisions only; it does **not** modify ADR-0001
  (Commitment 2 already permits Python for LLM-adjacent services; Commitment 5 already pins LangGraph).
  The *testing* techniques are recorded separately in
  [ADR-0017](0017-testing-ai-integrated-systems.md).

## Context

Milestone 9 adds an LLM community moderator. It is the first service that is not TypeScript, so it
must honour the architectural commitments (RFC 7807, `tenant.id` on every span, branded IDs, typed
events, single-writer, `/system/state` + `/system/capabilities`, Idempotency-Key on mutations)
*without* the TypeScript lint/codegen machinery that enforces them elsewhere, and without quietly
forking the conventions. Several genuinely-open choices had to be made; they are fixed here.

## Decision

**1. Toolchain: `uv`, isolated in `services/moderator-agent/`.** A self-contained `pyproject.toml` +
committed `uv.lock`, pinned to **Python 3.13** (broad wheel support across LangGraph / pgvector /
psycopg / OTel; 3.14 native-extension wheels still lag). `ruff` (lint + format), `pyright` (types,
`standard`), `pytest` (with
`pytest-asyncio`). The root `pnpm-workspace.yaml` is **not** expanded; a thin `package.json` exposes
`uv run …` under turbo task names (`typecheck`, `test`, `build`, `openapi:generate`,
`asyncapi:generate`, `eval:*`) so `turbo run typecheck|test` and the per-service filter reach Python.
`uv run` is self-bootstrapping, so these work from a clean checkout. (Rejected: a top-level uv
workspace alongside pnpm: dual-runtime complexity for no gain; the service is dependency-isolated.)

**2. The moderator OWNS its decisions; it proposes, it does not enforce.** It persists a
`ModerationDecision` (`mdec_<ulid>`) in its *own* Postgres, exposes them over its own REST API
(`GET /api/communities/{communityId}/moderation-decisions[/{decisionId}]`, plus a
`POST …/review` trigger), and emits `qaroom.moderator.decision.<community_id>.recorded`. It never
mutates content- or flags-service. (Rejected: repurposing flags-service `advanceRollout` to create
per-post flags: semantically wrong, the rollout machine is not a moderation queue, and it couples
two services for no benefit. Rejected: event-only with no store: a weak `/system/state` story and
nothing to inspect.) A downstream human review queue or notifier consumes the event; auto-enforcement
is explicitly out of scope.

**3. Community rules live in the moderator's Postgres, seeded from versioned files.**
`rules/<community_id>.yaml` is the source of truth, upserted on boot (`seed_rules`) and injected into
the prompt at decision time. Rules are therefore version-controlled and testable, not buried in a
prompt string. (Rejected: a new cross-service rules endpoint: heavier, and rules are the moderator's
concern; deferred until another service needs them. Rejected: hardcoded prompt: no per-community
story.)

**4. Dedup is layered, NOT a single mechanism: the deliberate asymmetry vs the TS services.** The
moderator does **not** replicate the `@qaroom/messaging` outbox / `processed_events` / advisory-lock
machinery (Commitment 17). Three layers cover at-least-once delivery instead, each with a precise
job:
- **JetStream `duplicate_window` (5 min)** on the *source* `post.created` Msg-Id drops exact
  redeliveries before the moderator even sees them.
- **`UNIQUE(event_id)` on `moderation_decisions` + the `is_new` guard** is the real *effect* dedup:
  `remember` and `lamport.bump()` run exactly once per decision; a duplicate that slips past the
  window returns the originally-stored decision (not a freshly-minted `mdec_`).
- **A stable, decision-derived Msg-Id** (`evt_` + the decision's ULID body) makes the *publish*
  idempotent: it is re-published on every delivery, OUTSIDE the `is_new` guard, so a publish failure
  on first delivery is recovered on redelivery (the failure propagates -> the consumer naks -> retry),
  and a successful prior publish is deduped downstream. This is the outbox-free at-least-once
  guarantee; without publishing outside the guard, a publish failure would leave a decision persisted
  but never published (caught in the Milestone-9 adversarial review).

LangGraph's `thread_id = event_id` checkpointer is the *crash-recovery* layer (resume a run
interrupted mid-flight), **not** the duplicate-suppression layer. That distinction matters and the
checkpointer alone does not make a completed-then-redelivered event a no-op. This whole asymmetry is a
scope choice: porting the TS dedup stack to Python costs more than it teaches. Consequence: an LLM/DB
*dependency* failure is recorded as a `Failed` workflow (visible in `/system/state`) and the message
is acked rather than retried: auto-retry on a provider outage is a documented limitation (M14 DST is
where fault-injection on this harness belongs); a *publish* failure, by contrast, naks and retries.

**5. Contracts are mirrored, Zod stays the source of truth, drift is gated in both languages.** The
emitted event has a Zod schema in `packages/contracts`; `pnpm moderator:contracts` projects it to a
JSON Schema (branded-id patterns included), the Zod side drift-gates that file, and the Pydantic
mirror validates its output against the *same* file (a pytest). NATS subject builders are
reimplemented in Python and gated against a `subjects.golden.json` emitted from `subjects.ts`. The
moderator's `openapi.yaml` is generated from FastAPI and `asyncapi.yaml` from the committed event
schema, each drift-gated by a pytest (not the TS `openapi:verify`, which iterates the TS services).

**6. Determinism is mirrored; the LLM is plain DI behind a provider-agnostic library, not the
ModelClient seam.** `Clock`, `IdGenerator` (prefixed Crockford-ULID), and `Randomness` are injected
exactly as in TS; production wires the real trio, tests wire seeded doubles. The LLM and embedder are
injected too, behind the `LlmClient`/`Embedder` Protocols: production uses **LangChain's
`init_chat_model` + `with_structured_output` and `init_embeddings`** (the idiomatic choice, the
workflow already runs on LangGraph), so the provider is a config string (`openai:gpt-5.5` ->
`anthropic:…` is one line): the answer to the vendor-objectivity caveat in ADR-0017 and a clean way
to handle reasoning-vs-non-reasoning parameter quirks. Both clients are built **lazily** so the
service boots (and serves `/health`, `/ready`) without an API key. Tests wire
`RuleKeywordLlm`/`ZeroEmbedder`. This is *ordinary* dependency injection, **not** the record/replay
`ModelClient` seam (no cassettes, no lint rule); that lands in Milestone 14 (ADR-0017). (Rejected for
now: LiteLLM/Instructor: their value is 100+ providers / a central proxy / validated retries off
native structured outputs, none of which the current OpenAI-only scope needs; LangChain is already in
the tree via LangGraph.)

**7. Deploy reuses the container-generic shared chart.** `deploy/moderator-agent/values.yaml`
overrides the image, port (8086), and Postgres image (`pgvector/pgvector:pg18`, the `vector`
extension), and injects `NATS_URL` + `OPENAI_API_KEY` via `extraEnv` (empty by default; the key is
injected at deploy and `/health`/`/ready` need no LLM call, so the pod boots without it: the same
dev-plaintext posture as `postgres.password`, ADR-0009). A `Dockerfile` (uv + uvicorn) and a Tiltfile
entry (uv, not tsx) complete the local stack. CI runs a dedicated `moderator` job (ruff + pyright +
pytest against a pgvector service) and a key-gated `moderator-evals` job; the chart is added to the
`chart` lint gate. The moderator is **not** added to the 3-service `cluster-smoke` subset. That
representative smoke (which also omits flags/donations/web) is covered for the moderator by its
dedicated job, the pgvector integration tests, and `helm template | kubeconform`.

**8. Which conventions are honoured, and which have no Python enforcer yet.** Architectural
conventions apply and are implemented: RFC 7807 (+`retryable`/`next_actions`/`failure_domain`),
`tenant.id` on every span, GenAI semconv on LLM spans, branded IDs (Pydantic patterns), typed events
via subject builders + `Nats-Msg-Id`, single-writer (advisory lock + `UNIQUE`), Idempotency-Key on
the `review` mutation with an OAS `links` declaration, and the `/system/*` envelope. The
*lint-enforced* TS conventions (`no-new-date`, `no-unseeded-random`, test-name shape, no-snapshot)
have no ruff equivalent yet; they are upheld by the determinism trio (which removes the need for the
globals) and review. `ruff` covers Python style; file-length discipline is observed by hand.

## Consequences

### Positive
- A polyglot service drops onto the substrate with no new infra: the same Helm chart, the same OTel
  collector, the same `summary.json`, the same NATS stream: only the language differs.
- The owns-its-decisions seam keeps the boundary clean and gives the agent a real, inspectable
  `/system/state` (decision + embedding counts, current workflow state) and its own contract.
- The dedup asymmetry is documented intellectual honesty rather than a hidden divergence.

### Trade-offs accepted
- Two dedup stories now exist (TS outbox/processed_events vs Python checkpointer). A reader must
  learn both. Justified: replicating the TS stack in Python teaches little and costs much.
- Contract parity between Zod and Pydantic relies on generated-file drift gates, not a shared type.
  There is no single compiled artifact both consume. The two-sided gate is the mitigation.
- The moderator can miss events while down and does not auto-retry a provider outage within a run;
  recovery is via the durable stream on restart + manual replay. Acceptable for v1; DST is M14.
- Without a checkpoint suppressing it, a >5-min-late duplicate re-runs the workflow (a second LLM
  call) before the `UNIQUE(event_id)` guard discards the effect: bounded waste, deduped downstream
  by the stable Msg-Id. The dev-only `POST /review` trigger is unauthenticated and is disabled in the
  prod values (`MODERATOR_ENABLE_MANUAL_REVIEW=false`); the production path is NATS, not REST. Token
  spend is bounded per-call (post truncated to `moderator_max_post_chars`) but per-request rate
  limiting for the review endpoint is the gateway's job, not the agent's.

## Rejected alternatives

- **Repurposing flags-service for moderation actions:** wrong semantics, cross-service coupling.
- **A full `@qaroom/messaging` Python port:** high cost, low teaching value; the checkpointer suffices.
- **Pydantic-first contracts (Python as the source of truth):** inverts the established Zod-first
  pipeline and the cross-service convention; Python mirrors, it does not lead.
- **Auto-enforcing moderation** (hide/delete posts): a policy/safety surface beyond the milestone's
  "propose" scope; the agent records a decision, a human (or a later milestone) acts.
- **A bespoke chart for the Python service:** unnecessary; the shared chart is already
  container-generic (it only sets PORT/DATABASE_URL/OTEL_*/extraEnv + HTTP probes).

## Related decisions

- [ADR-0001] Commitments 2 (Python only for LLM), 4 (single-writer), 5 (LangGraph), 6 (determinism),
  7 (observable state), 9 (communities-as-tenants), 13 (RFC 7807), 17 (async dedup).
- [ADR-0009] Kubernetes/Helm + the dev-plaintext secret posture reused here.
- [ADR-0012] the reverse-conformance discipline the LangGraph workflow reuses.
- [ADR-0017] the testing techniques for this service.
- [`AGENTS.md`](../../AGENTS.md) "Milestone awareness" (Milestone 9); `services/moderator-agent/AGENTS.md`.
- [`docs/spikes/06-test-name-rule.md`](../spikes/06-test-name-rule.md): the `test-name-shape` lint
  rule named in Decision 8 among the TS conventions that have no ruff equivalent for this Python service.
