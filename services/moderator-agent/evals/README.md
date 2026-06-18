# Moderator evals — read this before reading a green run

The eval suite (DeepEval RAG metrics, DeepTeam OWASP red-team, metamorphic paraphrase-invariance)
runs the **real, key-gated model**. That makes one rule load-bearing:

> **LLM-behaviour outcomes are tracked METRICS, not falsifiable GATES.**
> Only deterministic, model-free tests earn `prove --break` teeth and a place in
> `scripts/lib/manifests/claims.ts`.

## Why

A deliberate-bug demo that depends on the model exhibiting the bug has a **shelf life**. The
detection matrix (Tier C, 2026-06-10) armed all five moderator bug-toggles against the whole eval
battery and caught **0 of 15** — not because the battery is broken, but because the pinned
`gpt-5.5` snapshot now resists the planted injection and absorbs the planted prompt-bug on its own.
The old `assert "the injection lands"` went red for the *wrong* reason (the bug stopped
reproducing), and an `assert "invariance holds"` stays green whether or not the bug is present.
**A green/red gate cannot distinguish "we caught the bug" from "the model outgrew the bug."**

## The split this repo enforces

| Layer | What it proves | Status | Can it rot? |
|---|---|---|---|
| `tests/test_guard.py` | the guard CODE fences untrusted bodies as DATA | **claim** `input-guard-fences-untrusted-body` (`prove --break`) | no — pure string transform, no model |
| `tests/test_config_defaults.py` | every bug-toggle defaults OFF | keyless gate | no |
| `tests/test_workflow_decision.py` | abstain/calibration LOGIC | **claim** `moderator-abstain` | no — deterministic workflow |
| `evals/redteam` DeepTeam/PyRIT | attack-success **rate** vs the live model | **metric**, tracked across model versions | yes — by design |
| `evals/deepeval` RAG metrics | grounding / retrieval quality vs the live model | **metric** | yes |

## How to read each outcome

- A **deterministic gate** going red = a real regression. Trust it.
- A red-team **metric** climbing (attack success rate up) across model versions = a real regression.
- A behavioural demo that **stops reproducing** its planted bug (e.g.
  `test_injection_payoff_is_recorded_not_asserted` SKIPs) = a **recalibration signal**, not a pass
  and not a failure: the payload no longer bites this model. Strengthen the payload, or accept the
  guarantee now rests on the model — and lean on the deterministic mechanism test for teeth.

When you bump the model or a prompt, **re-run the falsifier** (`pnpm matrix --tier llm`): a toggle
that stops biting is telling you the demo decayed, not that the system is safe.
