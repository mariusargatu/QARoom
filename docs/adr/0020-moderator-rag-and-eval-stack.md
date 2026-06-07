# ADR 0020: Moderator as a retrieval-grounded agent; the eval + red-team stack

- **Status:** Accepted
- **Date:** 2026-06-05
- **Implemented:** Milestone 12
- **Supersedes:** ADR-0017's *tool choices* (Promptfoo -> DeepEval for evaluation; adds a red-team tool) and **extends** ADR-0018 (the moderator becomes a genuine retrieval-grounded RAG agent, not a prompt-baked classifier). Does **not** modify any ADR-0001 commitment. Slotted as **Milestone 12** on the roadmap (a v2 re-scope of the Milestone-9 moderator), replacing the dropped Deterministic-Simulation-Testing candidate.
- **Records:** the decision to upgrade the moderator's functional requirements so retrieval is *load-bearing*, and to align the testing stack accordingly: RAG-quality + agentic evaluation via **DeepEval**, adversarial testing via **DeepTeam**, with **Promptfoo dropped**.

## Context

ADR-0018 ships a moderator that judges posts against per-community rules baked into the system prompt; `pgvector` exists but is underused (post embeddings, not a policy corpus). ADR-0017 chose **Promptfoo** for golden-set evaluation and explicitly flagged a risk: *"Promptfoo is OpenAI-owned."* That risk is now realized: **OpenAI acquired Promptfoo in March 2026** (~$86M, kept MIT). An OpenAI-owned harness *evaluating and red-teaming* OpenAI models is the conflict ADR-0017 warned about.

Two questions were verified against the 2026 landscape before this ADR:

1. **Is RAGAS additive or redundant given DeepEval?** Redundant as a separate framework. DeepEval re-implemented RAGAS's RAG metrics natively (faithfulness, contextual precision / recall / relevancy) in early 2024, adding explainability and judge-debugging RAGAS lacked, and ships a `RAGASMetric` wrapper for the rest. DeepEval runs against any custom endpoint (supply `input` / `actual_output` / `retrieval_context`) with any judge model, pytest-native for CI.
2. **Is DeepTeam viable for the moderator?** Yes. Its `model_callback` wraps any target (the LangGraph moderator via a callback hitting its endpoint); 40+ vulnerability types, 10+ attack methods (jailbreak, prompt injection, evasion, data extraction, response manipulation), the clearest OWASP LLM Top 10 mapping, Apache-2.0, CI examples. Caveat: one comparison rates it research-grade vs Promptfoo's CI maturity, mitigated by pairing PyRIT for multi-turn depth.

The honest framing (recorded so it is not mistaken for product necessity): this is a **demonstration re-scope**. The moderator does not *need* RAG to function. It is upgraded because (a) a retrieval-grounded, citation-bearing, precedent-consistent moderator is genuinely *better*, and (b) doing so makes retrieval quality and agentic behaviour first-class testable surfaces, letting QARoom demonstrate RAG, RAG-evaluation, agentic-evaluation, and LLM red-teaming as distinct techniques. The requirement upgrades are real, not invented to justify tools; the tools follow the requirements, not the reverse.

## Decision

### Functional upgrade: retrieval becomes load-bearing

| FR | Requirement | Makes testable |
|---|---|---|
| **FR1** | **Policy corpus per community**: versioned rules, escalation guidelines, and prior decisions (precedent), embedded in `pgvector`. | corpus is data, not prompt |
| **FR2** | **Retrieve-then-reason**: per post, retrieve top-k policy chunks + similar past decisions; the verdict is *derived from retrieved context*, not from prompt-baked rules. | retrieval load-bearing -> context precision/recall meaningful |
| **FR3** | **Grounded, citation-bearing verdict**: structured output carries `cited_rules[]`, `precedents[]`, and a `rationale` traceable to retrieved chunks. | faithfulness; hallucinated-policy detection |
| **FR4** | **Precedent consistency**: verdict consistent with retrieved precedent for similar content, or an explicit `departs_from_precedent` flag + reason. | consistency; retrieval recall |
| **FR5** | **Abstain / escalate**: on low retrieval confidence or conflicting rules, emit `escalate_to_human` rather than guess. | calibration ("knows what it doesn't know") |
| **FR6** | **Agentic trajectory** (LangGraph): retrieve -> gather precedent -> draft -> self-check against cited rules -> emit; each node observable via `/system/state` + spans. | task completion, tool correctness, trajectory |

The structured-output contract (ADR-0018) extends with `cited_rules`, `precedents`, `departs_from_precedent`, and `disposition ∈ {approve, remove, escalate_to_human}`. `/system/state` adds corpus/retrieval counts to the existing decision + embedding counts.

### Evaluation: DeepEval is the single CI eval harness

- **DeepEval** (Apache-2.0, pytest-native, vendor-neutral judge) runs all evaluation in CI with pass/fail thresholds:
  - **RAG metrics** (FR2/FR3): faithfulness, contextual precision / recall / relevancy, native DeepEval implementations.
  - **Agentic metrics** (FR6): task completion, tool correctness, trajectory.
  - **Custom G-Eval metrics** (FR4/FR5): precedent-consistency, should-have-abstained / calibration.
- **RAGAS is not adopted as a separate framework**: DeepEval subsumes its metrics. If a RAGAS-specific metric is wanted (e.g. noise sensitivity), it runs through DeepEval's `RAGASMetric` wrapper in a single named eval, so the technique is demonstrated without a redundant parallel dependency.
- **Metamorphic paraphrase-invariance is kept** (ADR-0017): orthogonal to retrieval quality; expressed as a DeepEval test.
- **LangGraph reverse-conformance is kept** (ADR-0017): off-model transition detection via `xstate.transition`-style spans + trace assertions.

### Red-team: DeepTeam, drop Promptfoo

- **DeepTeam** (Confident AI, Apache-2.0) is the primary adversarial harness: `model_callback` wraps the moderator endpoint; OWASP LLM Top 10 mapping; jailbreak / prompt-injection / data-extraction / response-manipulation. The **prompt-injection-in-post-body** surface (untrusted post content flows to the LLM) is the headline target, a real attack, also earmarked for `docs/failure-modes.md` (ADR-0006).
- **PyRIT** (Microsoft, MIT) is an optional nightly for multi-turn attack depth (Crescendo / TAP).
- **Promptfoo is dropped.** Keeping it only for red-team would re-introduce the OpenAI-ownership conflict ADR-0017 flagged, plus a Node tool inside a Python service.

### Machine-readable rail

The frozen `summary.json` envelope is untouched. The `promptfoo` runner is replaced by **`deepeval`** and **`deepteam`** runners, riding the existing extensible per-runner `output` / `seeds` fields (no schema change, same mechanism ADR-0017 used). Both are **key-gated and cost-guarded** exactly as ADR-0017 specified: they hit the pinned model in CI only when a key is present, with a per-run budget cap and a pre-flight cost estimate.

## Consequences

### Positive

- A retrieval-grounded, citation-bearing, precedent-consistent, abstaining moderator is a strictly better agent, and makes retrieval + agentic behaviour first-class testable surfaces.
- One Apache-2.0, Python-native, vendor-independent stack (DeepEval + DeepTeam, optional PyRIT). Idiomatic for the Python moderator.
- **Resolves** ADR-0017's own flagged "OpenAI evaluating OpenAI" risk instead of preserving it.
- Demonstrates four distinct techniques rarely bundled: RAG, RAG-evaluation, agentic-evaluation, and LLM red-teaming, with the honest call that RAGAS-as-a-separate-tool is redundant (a demonstrated *judgment*, not just a tool list).

### Negative / trade-offs accepted

- **Re-scopes Milestone 9.** Adds a policy corpus + retrieval pipeline + citation schema + abstain logic. Real scope growth; justified on demonstration grounds, not on "the moderator needs it to function."
- Supersedes committed tool decisions in ADR-0017 and extends ADR-0018, both recorded here, not silently changed.
- DeepTeam carries a CI-maturity caveat vs Promptfoo; mitigated by PyRIT for depth and by DeepTeam's own GH-Actions integration.
- A larger eval surface costs more tokens per CI run; the existing cost-guard + key-gate (ADR-0017) is the control.

## Rejected alternatives

- **RAGAS as a separate framework**: redundant; DeepEval re-implemented its metrics natively and wraps the rest. Adopting both is tool-bloat.
- **Keep the classifier, bolt RAGAS on**: RAG-theater; retrieval would not be load-bearing, so RAG metrics would be meaningless.
- **Promptfoo for red-team only**: re-introduces the OpenAI-ownership conflict + a second language.
- **Garak only** (NVIDIA): strong model-layer probe library but weak agentic/RAG coverage; the moderator's risks are application-layer.
- **DeepTeam dropped in favour of Promptfoo red-team**: rejected on vendor-neutrality + Python-consolidation grounds.

## Related decisions

- [ADR-0017](0017-testing-ai-integrated-systems.md): superseded tool choices (Promptfoo -> DeepEval; red-team added). Metamorphic + reverse-conformance + cost-guard/key-gate retained.
- [ADR-0018](0018-moderator-agent-architecture.md), extended: the moderator becomes a retrieval-grounded RAG agent (FR1–FR6).
- [ADR-0006](0006-mcp-as-tested-service.md): tool-result prompt-injection as a `failure-modes.md` entry; the red-team surface here feeds it.
- `docs/04-roadmap.md`: **Milestone 12** (this re-scope; replaced the dropped DST candidate) and Milestone 9 (the original agentic moderator it extends).
