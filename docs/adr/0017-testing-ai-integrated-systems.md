# ADR 0017: Testing AI-integrated systems: the techniques that don't fit the traditional pyramid

- **Status:** Accepted
- **Date:** 2026-06-04
- **Records:** how QARoom tests the Milestone 9 `moderator-agent`, an LLM-backed service whose
  System-Under-Test is *stochastic*. Covers golden-set evaluation (Promptfoo), metamorphic testing,
  structured-output validation as a contract, LangGraph state-machine reverse-conformance, and the
  per-run cost guard. Records *implementation* decisions only; it does **not** modify any ADR-0001
  commitment. The moderator's *architecture* (Python tooling, the action seam, the dedup asymmetry)
  is recorded separately in [ADR-0018](0018-moderator-agent-architecture.md). Builds on the
  determinism trio (Commitment 6), observable state + conformance (Commitment 7), reverse-conformance
  via OTel transition spans ([ADR-0012](0012-feature-rollout-state-machine-and-reverse-conformance.md)),
  GenAI OTel conventions (Commitment 12), the frozen `test-results/summary.json` schema
  (Commitment 14), and the regression catalog ([ADR-0015](0015-scenarios-as-first-class-artifacts.md)).

## Context

Every technique before Milestone 9 assumes a deterministic SUT: the same input yields the same
output, so a test can pin an exact expectation. An LLM breaks that assumption. `temperature=0` + a
fixed `seed` + structured outputs make the OpenAI call *as* deterministic as the provider allows, but
the provider does not guarantee bit-stability, and the interesting failures are *semantic*, not
crashes. Three questions the pyramid can't ask:

- **"Is the agent right on the cases we care about?"**: a golden set of moderation scenarios with
  expected verdicts. This is evaluation, not unit testing: the oracle is a human-curated label, and
  the run hits a real model.
- **"Is the agent *consistent*, does a reworded-but-equivalent post get the same verdict?"**: a
  *metamorphic* relation (paraphrase invariance). A golden eval cannot express this: it checks fixed
  input -> fixed output; it never asks whether two semantically-equal inputs agree.
- **"Did the agent stay on its rails?"**: the LangGraph workflow is a state machine, so the same
  reverse-conformance discipline the XState services use (ADR-0012) applies: every transition it
  takes must be a legal edge of the hand-authored model.

The service logic *around* the model (the graph, persistence, dedup, RFC 7807, `/system/state`) is
ordinary deterministic code and is tested as such; the LLM is injected, so those tests wire a
deterministic fake and never call the network. Only the eval and metamorphic layers touch the real
provider.

## Decision

**1. The eval lane calls real OpenAI; the service-logic lane never does.** Per the roadmap-literal
choice, Promptfoo and the metamorphic test hit the pinned model (`gpt-5.5`: a *reasoning* model,
so `reasoning_effort`, not `seed`/`temperature`; structured outputs via Pydantic) with a pre-flight
**cost guard**
(`eval_cost_guard.py`) that estimates token spend and fails before any call if it exceeds
`MODERATOR_EVAL_BUDGET_TOKENS`. These jobs run on push/schedule and only when the `OPENAI_API_KEY`
secret is present (so a fork PR skips them, never breaks). The **determinism trio still holds for
everything else**: the workflow/persistence/API unit suite injects `RuleKeywordLlm`/`ZeroEmbedder`
and is fully reproducible. A record/replay `ModelClient` seam (cassettes + scripted oracle + a
`no-raw-openai` lint rule) is **deferred to Milestone 14**. Here the LLM is plain dependency
injection (ADR-0018).

**2. Golden-set evaluation (Promptfoo) pins SME-labelled input -> verdict.** `evals/promptfooconfig.yaml`
runs the **real** prompt: `moderation.prompt.json` is generated from the service's own
`build_system_prompt` over the committed community rules and drift-gated by a pytest, so the eval can
never diverge from the running agent. Assertions check the parsed `verdict`. Results fold into
`summary.json` as a `promptfoo` runner.

The **oracle is SME-labelled with measured agreement, not developer-asserted** (`golden/`). Candidates
are drafted (drafting may be automated), then labelled independently by **three SME raters**; the
inter-rater agreement is **Fleiss' Kappa** (the right statistic for 3+ raters: Cohen's Kappa is
2-rater only; Krippendorff's alpha is the alternative for missing labels). Only cases with **unanimous
agreement become gold**; split cases are kept as documented `ambiguous` (held out of the eval, they
are signal about fuzzy policy and good metamorphic fodder), never silently averaged into a gold label.
`golden:build` recomputes Kappa + the gold/ambiguous split (drift-gated, with a Kappa≥0.6 floor); the
agreement report folds into `summary.json` as a `golden-sme` runner. v1's three SMEs are LLM-proxy
personas (strict / free-expression / harm-focused) standing in for human experts. The *framework* is
the deliverable; real deployment swaps in human SMEs. A low Kappa is itself a finding: it flags
ambiguous content or a rule that needs sharpening.

**3. Metamorphic testing is the layer that catches what the golden eval can't, and the
deliberate-bug demo proves it.** `check_paraphrase_invariance` asserts that every paraphrase of a
canonical post gets the canonical's verdict. The `MODERATOR_PROMPT_BUG` toggle (mirroring the TS
`CONTENT_BUG_*` convention) swaps in a prompt that keys on literal wording: the **golden eval still
passes** (its inputs are canonical), but the **metamorphic test fails** on the paraphrases. The
invariance *checker itself* is unit-tested deterministically (a phrasing-sensitive fake produces
violations; a semantic fake does not), so the harness is trustworthy even when the real-model run is
skipped.

**4. Structured output is a cross-language contract, validated on both sides.** Every LLM response is
parsed into the Pydantic `LlmVerdict` via `response_format`; a malformed/refused response maps to RFC
7807 `dependency_failure`. The emitted `moderation.decision.recorded` event is the Zod schema's
mirror: `pnpm moderator:contracts` generates a JSON Schema from the Zod source, the Zod side
drift-gates it (a vitest test), and the Python side validates its Pydantic output against the *same*
committed file (a pytest). Neither language can silently drift from the wire format.

**5. LangGraph conformance reuses the XState playbook (ADR-0012).** The workflow model
(`workflow/model.py`) is the single authority on legal transitions; the runner emits an
`xstate.transition` span with byte-identical `xstate.{machine,from,to,event,at}` attributes, so the
Milestone-5 Tracetest reverse-conformance assertion works unchanged. A conformance test asserts every
emitted transition is legal; a model-validation test asserts states/events are self-consistent and
every state is reachable.

**6. Every runner emits machine-readable output (Commitment 14).** The Python pytest run folds a
`moderator` runner into `summary.json` (a sessionfinish hook + `moderator-results.ts`); Promptfoo
folds a `promptfoo` runner (`promptfoo-results.ts`). The frozen envelope is untouched: both ride the
extensible per-runner `output`.

## Consequences

### Positive
- The **golden + metamorphic pair** is the headline: one pins correctness on known cases, the other
  catches a regression class (phrasing sensitivity) that no fixed-output test can see. The
  deliberate-bug demo makes the gap concrete and reproducible.
- Service logic stays deterministic and free to run on every PR; the stochastic, paid lane is
  isolated to push/schedule with a hard cost ceiling.
- Reusing the OTel transition-span contract means an LLM agent is conformance-checked by the *same*
  Tracetest assertion as the feature-flag machine: no new observability surface.

### Trade-offs accepted
- The eval lane is non-deterministic and costs money. Mitigated by `temperature=0`/`seed`, the
  pre-flight cost guard, and key-gating (it simply skips where no key exists). The eval result is a
  signal, not a hard merge gate, by nature.
- **Promptfoo is OpenAI-owned** as of 2026. An OpenAI-owned harness evaluating OpenAI models has a
  vendor-objectivity caveat. Accepted for v1; the metamorphic layer (our own code) is the
  vendor-neutral check, and the provider is swappable in the config.
- No cassette/replay yet, so an offline run can't exercise the *real* prompt path, only the fake.
  Deferred to the Milestone-14 `ModelClient` seam on purpose (it would cost more than it teaches now).
- **Prompt injection is mitigated, not eliminated.** The post body is concatenated into the user
  message; structured outputs (`response_format`) constrain the model to a valid `LlmVerdict` (no
  *structural* escape), and the "judge MEANING" prompt resists "ignore your rules" attempts. A golden
  case asserts an injection attempt is still flagged on its merits. Semantic manipulation remains a
  residual risk, accepted for v1 (the agent proposes; a human reviews).

## Rejected alternatives

- **A record/replay `ModelClient` seam now.** Tempting for deterministic CI, but it is the headline
  of the Milestone-14 DST work; pulling it forward inflates Milestone 9. Plain DI + real-eval-in-CI
  satisfies the milestone (the user's explicit choice).
- **Metamorphic relations via Promptfoo's built-ins only.** Promptfoo can assert similarity, but the
  paraphrase-invariance relation is clearest as code we own and unit-test; it also runs without a key.
- **Gating the PR-fast path on a real LLM call.** Non-deterministic, paid, and unavailable on forks:
  it would make the inner loop flaky. Evals belong on push/schedule.
- **Snapshot-asserting full model outputs.** Forbidden anyway (no `toMatchSnapshot`), and brittle
  against a stochastic model; verdict-level assertions + metamorphic relations are the right grain.

## Related decisions

- [ADR-0001] Commitments 6 (determinism), 7 (observable state), 12 (GenAI OTel), 14 (machine-readable
  test outputs).
- [ADR-0012] reverse conformance via OTel transition spans, reused verbatim for LangGraph.
- [ADR-0015] the regression catalog a reified eval/metamorphic finding lands in.
- [ADR-0018] the moderator-agent's architecture (Python tooling, action seam, dedup asymmetry).
- [`ARCHITECTURE.md`](../../ARCHITECTURE.md) §3 (the testing portfolio);
  [`AGENTS.md`](../../AGENTS.md) "Milestone awareness" (Milestone 9).
