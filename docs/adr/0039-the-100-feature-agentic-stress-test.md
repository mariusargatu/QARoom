# ADR 0039: The 100-feature agentic stress test — five instrumented metrics, prepared not run (T26)

- **Status:** Proposed
- **Date:** 2026-06-28
- **Records:** the decision to instrument QARoom's check architecture as a **severe, falsifiable
  experiment** under an agentic writer — five metrics, each computed by a real function over a real
  merged source — and to ship the **slim** version of that experiment: PREPARE the 100-feature scenario
  and wire the metrics, stage and catch ONE cheat, but **do not drive 100 features**. It is the capstone
  of the backlog, composing [ADR-0032](0032-agentic-development-as-a-tested-boundary.md) /
  [ADR-0033](0033-check-governance-and-tamper-evidence-under-an-adversarial-writer.md) (the gates +
  tamper-evidence) and [ADR-0037](0037-promotion-ledger-green-head-and-governed-verdict-logic.md) (the
  promotion ledger).
- **Does not modify** [ADR-0001](0001-foundational-decisions.md). It is purely additive: a harness
  (`scripts/stress-experiment/`), a derived report (`docs/stress-experiment.md`) with a drift gate
  (`pnpm stress:verify`, wired into `pnpm verify`), and a gitignored sidecar
  (`test-results/stress-experiment.json`). The frozen `test-results/summary.json` schema
  ([test-results-schema.ts](../../packages/contracts/src/test-results-schema.ts), Commitment 14) is
  **untouched** — the sidecar references nothing in it. It **adds no new falsifiable claim** (it reuses
  an existing Tier-0 falsifier — see §"The single planted cheat") and **weakens no existing claim,
  schema, gate, or falsifier**.
- **Relates to:** [ADR-0030](0030-checking-architecture-in-service-of-a-testing-mission.md) (the spine:
  checking + evidence in service of a testing mission — this is its severe test),
  [ADR-0037](0037-promotion-ledger-green-head-and-governed-verdict-logic.md) (the ledger that sources
  false-green + time-to-culprit), [ADR-0033](0033-check-governance-and-tamper-evidence-under-an-adversarial-writer.md)
  (the attack taxonomy + anchored-severity + abort affordance that source cheat-rate, human-intervention,
  and anchored-ratio drift).

## Context

The backlog's headline demo asks: does the check architecture HOLD when the author is an agent that
attacks the GATES, not just the product? That is an **experiment**, and the discipline of an experiment
is that it must be able to FALSIFY its own thesis. A triumphant "the architecture survives agents" is
the failure mode — it is the confidently-wrong answer the oracle problem warns about. So the deliverable
is not a survival headline; it is an **instrument** that could read red, plus an honest naming of what it
cannot see.

Two scope facts shape this ADR:

1. **The full 100-feature run is expensive and not the point of the slim card.** Driving 100 real
   agent-authored features is a large, separate effort. The value the slim card captures is the
   INSTRUMENT: the five metrics, wired to their real sources, plus a single staged cheat proven caught.
   The full run is the scenario this PREPARES FOR, explicitly not executed (the owner's scope call).
2. **The metrics must be real functions over real inputs, not stubs.** Each reads a MERGED source
   (the promotion ledger, the attack taxonomy, the change classifier, the anchored-severity coverage),
   so the instrument cannot quietly become theater.

## Decision

### The five instrumented metrics (a sidecar; `summary.json` is frozen)

Each is a pure function in `scripts/stress-experiment/metrics.ts` over a real source, unit-tested with a
positive AND a negative fixture (a constant-return stub fails the test):

| # | Metric | Real source | What it measures |
|---|---|---|---|
| 1 | **cheat-rate** | the T23 attack taxonomy (`adversarial-taxonomy.ts`) + the gate-guard gate↔target detector (mirrors `.github/workflows/gate-guard.yml`) | fraction of features where the agent weakened a test/oracle or routed around an invariant |
| 2 | **false-green rate** | the T24 promotion ledger (`@qaroom/promotion-ledger`) | changes that passed PRESUBMIT_GREEN but a later, higher tier RED |
| 3 | **time-to-culprit** | the same ledger | wall-time + bisection commits from a batch red to the narrowed culprit row (O(log n)) |
| 4 | **human-intervention rate** | the T24 state-aware `classifyChange` (freeze-and-page) + the T23 abort affordance ("flag for a human") | changes an agent cannot silently auto-handle — a human edit is forced |
| 5 | **anchored-ratio drift** | the T23 anchored-severity coverage (CLAIMS owning BOUNDARY_REGISTRY rows) | whether the human-anchored surface erodes as features pile up |

They are recorded into a gitignored sidecar (`test-results/stress-experiment.json`) — never into the
frozen `summary.json`.

### The derived report + its drift gate

`pnpm stress:render` writes `docs/stress-experiment.md` from `computeMetrics(STRESS_SCENARIO)` — the T25
Layer-2 pattern: every number derives from the metric functions, none is hand-typed. The committed doc
must be byte-identical to a fresh render; `pnpm stress:verify` (wired into `pnpm verify`) reds on any
out-of-band edit, the same byte-gate discipline as render-stats / render-claims / matrix:render. The
gate recomputes from the committed scenario (not the gitignored sidecar), so it runs offline in `verify`.

### The single planted cheat, caught by an agent-independent Tier-0 falsifier

One adversarial cheat is staged (independent-party framing): the `equals-true` attack — an `__eq__`→True
/ assertion-less test, the ImpossibleBench GPT-5 move. It is proven caught by an EXISTING Tier-0
falsifier, the [`agent-test-has-teeth`](../claims.md) claim (`pnpm prove agent-test-has-teeth --break`
arms `AGENT_EMIT_ASSERTIONLESS_TEST` and the in-process mutation gate reds). **No new claim was added** —
reusing a falsifier that already demonstrates the catch avoids the T25 anti-theater lesson (a new claim
that only restates an existing one is decoration). The harness asserts the cheat is BOTH real theater (a
weak check greens it) AND caught (the named defense reds it).

## Named limits (the deliverable is naming them)

1. **The full 100-feature run is not executed.** This is the slim scope: the instrument and one caught
   cheat. The full run is the scenario this prepares for.
2. **It tests THIS system, under THESE agents, against THIS threat model.** It does not prove general
   agent safety. The taxonomy is the measured ImpossibleBench / METR / Anthropic record, not every
   possible attack.
3. **The oracle problem stands** (STORY open problem 1): a maximally severe run of the WRONG property is
   confidently wrong, faster. These metrics measure whether the checks held — not whether the checks were
   the right ones. No amount of instrumentation closes this gap; it is named, not solved.

## Consequences

### Positive
- The headline demo is an INSTRUMENT, not a slogan: five metrics that could read red, each sourced from
  the real T23/T24 machinery, plus a staged cheat proven caught by an agent-independent falsifier.
- The report is derived and drift-gated, so it cannot decay into stale prose.

### Trade-offs accepted
- The scenario is a small, deterministic FIXTURE, not a recording of a real 100-feature run. Accepted and
  stated plainly: the slim card prepares the run; it does not run it. A green here is "the instrument is
  wired and the staged cheat is caught", not "the architecture survived 100 agent features".
- The metrics measure whether checks held, not whether they were the right checks (limit 3). Accepted —
  the oracle problem is a property of all testing, named here so the demo is not mistaken for a proof.

## Related decisions
- [ADR-0030](0030-checking-architecture-in-service-of-a-testing-mission.md) — the spine this is the severe test of.
- [ADR-0037](0037-promotion-ledger-green-head-and-governed-verdict-logic.md) — the ledger sourcing metrics 2 and 3.
- [ADR-0033](0033-check-governance-and-tamper-evidence-under-an-adversarial-writer.md) — the taxonomy, anchored-severity, and abort affordance sourcing metrics 1, 4, and 5.
- [ADR-0032](0032-agentic-development-as-a-tested-boundary.md) — the agentic boundary the staged cheat lives on.
