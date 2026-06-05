# moderator-agent

QARoom's LLM community moderator (Milestone 9) — the project's first Python service. It subscribes to
`post.created` across every community over NATS, judges each post against that community's documented
rules with an OpenAI model, and **records a decision it proposes (it does not enforce)**: it persists
the decision in its own Postgres and emits `qaroom.moderator.decision.<community_id>.recorded`.

It is "an LLM agent on rails": the workflow is a hand-authored state machine (LangGraph), every LLM
call is pinned (`temperature=0`, fixed `seed`, structured outputs validated against a Pydantic
schema), and every transition is conformance-checked exactly like the XState services (ADR-0012).

See [ADR-0017](../../docs/adr/0017-testing-ai-integrated-systems.md) for the testing techniques and
[ADR-0018](../../docs/adr/0018-moderator-agent-architecture.md) for the architecture.

## The workflow as a state graph

Each review of one post walks this machine. The model in `src/moderator_agent/workflow/model.py` is
the single authority on which transitions are legal; the LangGraph runner emits an `xstate.transition`
span per step (identical attributes to the XState services) so the Tracetest reverse-conformance
assertion holds for the agent too.

```mermaid
stateDiagram-v2
    [*] -→ Received
    Received -→ Retrieved: ReviewRequested
    Retrieved -→ Classified: ContextRetrieved
    Classified -→ Recorded: VerdictProduced
    Received -→ Failed: DependencyFailed
    Retrieved -→ Failed: DependencyFailed
    Classified -→ Failed: DependencyFailed
    Recorded -→ [*]
    Failed -→ [*]
```

- **Received → Retrieved** (`ReviewRequested`): fetch the community's rules + nearest-neighbour
  precedent from the pgvector knowledge base.
- **Retrieved → Classified** (`ContextRetrieved`): the LLM returns a structured `LlmVerdict`
  (`verdict`, `rule_id`, `reason`, `confidence`).
- **Classified → Recorded** (`VerdictProduced`): persist the decision (single-writer per post),
  remember the post embedding, bump the LamportGate, and publish the event.
- **\* → Failed** (`DependencyFailed`): any dependency error (LLM, embeddings, DB) ends the run in
  `Failed`, surfaced in `/system/state` (recovery is via replay; auto-retry is out of scope — ADR-0018).

## Testing techniques (ADR-0017)

- **Golden-set eval (Promptfoo):** canonical post → expected verdict, against the real model.
- **Metamorphic test:** a benign paraphrase must get the same verdict. The `MODERATOR_PROMPT_BUG`
  toggle makes the prompt phrasing-sensitive — the metamorphic test **catches** it while the golden
  eval **misses** it. That gap is the whole point.
- **Structured-output contract:** the emitted event's Pydantic output is validated against the
  Zod-generated JSON Schema, gated on both sides.
- **LangGraph reverse conformance:** every emitted transition must be a legal edge of the model.

## Run it

The commands live in `AGENTS.md`. Quick start for the deterministic suite (no network, no DB):

```bash
pnpm --filter @qaroom/moderator-agent test
```
