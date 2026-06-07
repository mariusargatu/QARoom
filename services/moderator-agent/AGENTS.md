# moderator-agent

The one **Python** service (Milestone 9, re-scoped in Milestone 12): an LLM community moderator. It
subscribes to every community's `post.created`, judges each post against that community's rules, and
records a decision: it **proposes, it does not enforce** (ADR-0018). As of Milestone 12 ([ADR-0020])
it is a genuine **retrieval-grounded RAG agent** (FR1–FR6), not a prompt-baked classifier: a
per-community **policy corpus** (rules + escalation guidelines + precedent) in `pgvector`, retrieve-
then-reason, and a citation-bearing `disposition ∈ {approve, remove, escalate_to_human}` carrying
`cited_rules[]`, `precedents[]`, `departs_from_precedent`, and a `rationale`: abstaining
(`escalate_to_human`) on low retrieval confidence or conflicting rules. The verdict->disposition change
is a breaking event v2. Read the repo-root `AGENTS.md` first. The toolchain is `uv` (not pnpm); the
testing techniques are in [ADR-0017] + [ADR-0020], the architecture in [ADR-0018].

## Endpoints

| Method | Path | operationId | Notes |
|---|---|---|---|
| GET | `/api/communities/{communityId}/moderation-decisions` | `listModerationDecisions` | carries `as_of` |
| GET | `/api/communities/{communityId}/moderation-decisions/{decisionId}` | `getModerationDecision` | 404 -> RFC 7807 |
| POST | `/api/communities/{communityId}/posts/{postId}/review` | `reviewPost` | mutating; `Idempotency-Key`; OAS `links`->getModerationDecision; the production path is NATS |
| GET | `/system/state` | `getSystemState` | decision/embedding + corpus/retrieval counts + workflow state + `as_of` |
| GET | `/system/capabilities` | `getSystemCapabilities` | MCP-tool-shaped |
| GET | `/health`, `/ready` | - | liveness / readiness (DB ping) |

## Where things live

- **Workflow model:** `src/moderator_agent/workflow/model.py`: hand-authored, the single authority on
  legal transitions (the LangGraph sibling of `rollout.machine.ts`). Two-stage retrieval (ADR-0021)
  makes the trajectory six observable nodes: `retrieve -> rerank -> gather_precedent -> draft ->
  self_check -> record` (states `{Received, Retrieved, Reranked, PrecedentGathered, Drafted,
  SelfChecked, Recorded, Failed}`; `DependencyFailed` from the five I/O nodes: the pure self-check
  declares no failure edge). Runner: `workflow/graph.py`.
- **Retrieval seams (ADR-0021):** the four RAG sub-components are each injected + separately tested.
  `tokenize.py` — `Tokenizer` port (token-aware truncation; `TiktokenTokenizer`/`cl100k_base` in prod,
  `WordTokenizer` fake). `rerank.py` — `Reranker` port (stage 2: `LlmReranker` prod default,
  `KeywordReranker`/`IdentityReranker` fakes; grounding-guarded by `ground_order`;
  `MODERATOR_DISABLE_RERANK`/`MODERATOR_RERANK_BUG` toggles). Embedding + corpus/knowledge retrieval
  keep their existing `Embedder`/`PolicyCorpusStore`/`KnowledgeStore` ports.
- **Prompt:** `workflow/prompts.py`: honest vs `MODERATOR_PROMPT_BUG` variant (the deliberate-bug demo).
- **Input guard:** `guard.py`: fences the untrusted post body in unforgeable delimiters + a
  system-prompt defense clause (the DeepTeam prompt-injection target); `MODERATOR_DISABLE_INPUT_GUARD=1`
  is the deliberate bug (failure-modes §09).
- **LLM seam:** `llm.py`: LangChain `init_chat_model`/`init_embeddings` in prod (provider-agnostic, lazy, `openai:gpt-5.5`), deterministic fakes in tests.
- **Persistence:** `persistence/`: own Postgres + pgvector; the per-community **policy corpus**
  (rules + escalation guidelines + precedent) is embedded data, seeded from `rules/<community>.yaml`,
  not prompt-baked.
- **Consumer:** `consumer.py`: durable NATS sub on `qaroom.content.posts.*.created` (tenant-leak guarded).
- **Contracts:** Zod is the source of truth (`@qaroom/contracts`); the Pydantic mirror in `schemas.py`
  is gated against the committed `contracts/*.schema.json` and `contracts/subjects.golden.json`.
- **Evals (ADR-0020):** **DeepEval** is the single CI eval harness: native RAG metrics (faithfulness,
  contextual precision / recall / relevancy), agentic metrics (task completion, tool correctness,
  trajectory), and custom G-Eval (precedent-consistency, calibration); RAGAS rides DeepEval's
  `RAGASMetric` wrapper, not adopted separately. **DeepTeam** is the red-team (`model_callback`, OWASP
  LLM Top 10), **PyRIT** an optional multi-turn nightly. Both are key-gated + cost-guarded and fold
  into `summary.json` with no schema change. **Promptfoo is dropped** (OpenAI-acquired, March 2026).
  The SME-labelled gold set (`evals/golden/`: candidates -> 3 independent SME labels -> Fleiss' Kappa ->
  `golden:build` gates unanimous->gold, split->ambiguous) + `metamorphic.py` (paraphrase invariance) are
  retained. Agreement code: `src/moderator_agent/golden/`.

## Conventions enforced here

- Idempotency is the **LangGraph checkpointer** (`thread_id = event_id`) + `UNIQUE(event_id)`, NOT the
  TS `processed_events`/outbox machinery: the deliberate asymmetry (ADR-0018, Commitment 17).
- Every LLM call is a GenAI-semconv span with `tenant.id`; every workflow transition emits an
  `xstate.transition` span (same attrs as the XState services) for Tracetest reverse conformance.
- Branded IDs, RFC 7807 errors, typed events via `subjects.py` builders, single-writer per post.
- Determinism trio is injected; the LLM is plain DI (the `ModelClient` record/replay seam is M14).

## Commands

```bash
pnpm --filter @qaroom/moderator-agent test          # uv run pytest (in-memory fakes; pg/llm tests skip)
pnpm --filter @qaroom/moderator-agent typecheck     # uv run pyright
pnpm --filter @qaroom/moderator-agent lint:fix      # uv run ruff
pnpm --filter @qaroom/moderator-agent openapi:generate   # FastAPI -> openapi.yaml (drift-gated)
pnpm --filter @qaroom/moderator-agent asyncapi:generate  # event schema -> asyncapi.yaml (drift-gated)
pnpm --filter @qaroom/moderator-agent golden:build  # SME labels -> Fleiss' Kappa -> gold set
pnpm --filter @qaroom/moderator-agent eval:cost     # pre-flight token budget guard
pnpm --filter @qaroom/moderator-agent eval:deepeval # DeepEval RAG + agentic + G-Eval (needs OPENAI_API_KEY)
pnpm --filter @qaroom/moderator-agent eval:deepteam # DeepTeam OWASP red-team (needs OPENAI_API_KEY)
pnpm --filter @qaroom/moderator-agent eval:pyrit    # PyRIT multi-turn red-team, nightly (needs OPENAI_API_KEY)
pnpm moderator:contracts                            # regenerate the cross-language Zod->JSON-Schema gate
# integration tests against pgvector: QAROOM_TEST_DATABASE_URL=postgresql://… uv run pytest -m integration
# the real-LLM metamorphic + deliberate-bug demo: OPENAI_API_KEY=… uv run pytest -m llm
```

## Running in the cluster (the OpenAI key)

Classification needs `OPENAI_API_KEY` **inside the pod**. The client is lazy, so the pod boots and
serves `/health`, `/ready`, and the NATS consumer with no key, but every review fails until one is
set (a `Failed` decision, acked, visible in `/system/state`).

`pnpm dev` (Tilt) wires it for you: the `Tiltfile` reads `OPENAI_API_KEY` from your shell env, and
falls back to `services/moderator-agent/.env` (gitignored), then injects it via Helm. So just keep
the key in `.env`: no manual step. With no key found, Tilt prints a warning and deploys without it.

If you deployed the chart by hand (`helm template … | kubectl apply`), inject the key after:

```bash
# sources .env so you never paste the key
set -a && . services/moderator-agent/.env && set +a
kubectl set env deployment/moderator-agent -n qaroom OPENAI_API_KEY="$OPENAI_API_KEY"
kubectl rollout status deployment/moderator-agent -n qaroom
```

Dev-only plaintext posture, like `postgres.password` (ADR-0009), not for production, where the key
comes from a real Secret manager.

See `README.md` for the rendered workflow state graph.
