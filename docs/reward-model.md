# The agent reward model: a trust budget, never a presubmit tick

When an agent both writes the code and runs its gates, *what you reward* is a control surface. Reward the
wrong signal and you train the agent to farm it. This doc fixes the reward as a **dense/sparse split keyed
on the promotion ledger** ([`packages/promotion-ledger`](../packages/promotion-ledger/AGENTS.md), T24 /
[ADR-0037](adr/0037-promotion-ledger-green-head-and-governed-verdict-logic.md)). It is the operating
companion to [ADR-0038](adr/0038-operating-model-onboarding-agent-tax-and-incident-to-claim.md) §5.

## The core rule: never reward at presubmit

`true_head` (last merged) ≠ `green_head` (last *deployable*). A green presubmit lane is the **weakest,
earliest** signal and the **easiest to game** — edit the test, neuter the oracle, `sys.exit(0)`. So a green
tick on an open PR earns an agent **nothing**. Trust is granted only as a commit *survives the lagging
tiers*. The deployable pointer is derived, not asserted:
[`green-head.ts`](../packages/promotion-ledger/src/green-head.ts) computes the longest contiguous prefix
all `≥` the target tier with no outstanding revert.

## Dense steering vs sparse accounting

| | **Dense steering** | **Sparse accounting (the reward)** |
|---|---|---|
| **When** | at submit, every change | only on CANARY / WEEKLY survival |
| **What** | affected-and-severe signal: which gates the change touches, did the severe ones stay green | a **trust budget** increment, keyed on the ledger's tier verdicts |
| **Role** | *guidance* — steer the next edit | *credit* — the only thing that moves merge-rate |
| **Why split** | fast feedback must not become reward, or the agent optimizes presubmit-green | survival across the lagging tiers is the signal that cannot be faked cheaply |

The promotion ladder these key on is `SUBMITTED → PRESUBMIT_GREEN → POSTSUBMIT_GREEN → NIGHTLY_GREEN →
WEEKLY_GREEN → CANARY_GREEN` ([`tiers.ts`](../packages/promotion-ledger/src/tiers.ts)) — a **risk** ladder,
not a time ladder. Reward attaches at the top (CANARY/WEEKLY), never at the bottom (PRESUBMIT).

## Quarantine-and-confirm before attributing a red

≈84% of nightly reds are genuine flake, so a naïve "red → blame the last commit" both mis-rewards and
invites the cheapest Goodhart move: **relabel a real red as flaky** to advance green_head. Two defenses:

- **Confirm before attributing.** A red is attributed to a commit only past the `FLAKE_CONFIRM_RATIO` bar
  in [`verdict.ts`](../packages/promotion-ledger/src/verdict.ts) — quarantine, reproduce, then charge it.
- **Govern the measure.** The verdict logic is itself an invariant source under a meta-gate: the
  `relabeled-red-stays-red` claim proves a deterministic red can never be laundered into a flake
  (`pnpm prove relabeled-red-stays-red --break`). Measuring the measure is what keeps the reward honest.

## No auto-revert on the stateful change class

Reward and revert are paired controls. QARoom is event-sourced — a reverted migration, a consumed event, a
delivered webhook **cannot be un-emitted** — so revert is **state-aware**
([`change-class.ts`](../packages/promotion-ledger/src/change-class.ts)): only `pure-code` is auto-revertable;
every event-sourced class freezes `green_head` and pages a human. An agent cannot earn trust by churning a
stateful change green-then-red; the policy refuses to silently undo it.

## Tested SLO = alerted SLO

A reward keyed on survival is only as honest as the signals it survives. So the SLOs the agent is graded
against are the **same** ones production pages on: the alert thresholds derive from `SLO_TARGETS` /
`CONSUMER_LAG_SLO` in [`packages/contracts/src/slos.ts`](../packages/contracts/src/slos.ts) → 
[`deploy/observability/alerts.gen.yaml`](../deploy/observability/alerts.gen.yaml) (`pnpm alerts:gen`,
[ADR-0034](adr/0034-observability-hardening-pii-free-spans-consumer-lag-slo-and-alert-rule-testing.md)). A
bound you can test is a bound you are paged on — one source, two projections — so an agent cannot pass a
weaker SLO in test than the one that fires in production.

## What is built vs named

The buildable Tier-A core is in [`packages/promotion-ledger`](../packages/promotion-ledger/AGENTS.md)
(tiers, green_head, the governed verdict logic, the state-aware-revert *policy*). The CI orchestration that
*acts* on it — the trust-budget ledger, the canary AnalysisRun, the auto-revert bot, the batch+bisect — is
**Tier-B, named and deferred** in [ADR-0037](adr/0037-promotion-ledger-green-head-and-governed-verdict-logic.md)
because it can only be exercised against a live, multi-stage pipeline. Encoding it in-process would be the
theater this repo refuses.
