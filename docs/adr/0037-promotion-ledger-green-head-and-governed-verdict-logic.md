# ADR 0037: Promotion-ledger CI — green_head, risk-tiers, and governed verdict logic (T24)

- **Status:** Proposed
- **Date:** 2026-06-28
- **Records:** the decision to separate `true_head` (the last merged commit) from `green_head` (the
  deployable pointer), to advance the deployable pointer only by accumulated tier evidence held in an
  append-only **promotion ledger**, to make auto-revert **state-aware** (only pure code is reverted; an
  event-sourced change freezes + pages), and to govern the ledger's own verdict logic as an invariant
  source under a **meta-gate** ("measure the measure"). This ADR records the **buildable Tier-A core**
  (T24-A) and names the CI orchestration (T24-B) as the deferred scaffold.
- **Does not modify** [ADR-0001](0001-foundational-decisions.md). It is purely additive: one new
  package (`@qaroom/promotion-ledger`), one falsifiable claim (`relabeled-red-stays-red`), one
  deliberate-bug toggle (`LEDGER_RELABEL_RED_AS_FLAKY`), one CI flag workflow, and CODEOWNERS /
  invariant-guard extensions. The frozen `test-results/summary.json` schema
  ([test-results-schema.ts](../../packages/contracts/src/test-results-schema.ts), Commitment 14) is
  **untouched** — the ledger is a SIDECAR that references the envelope by content hash. It **weakens no
  existing claim, schema, gate, or falsifier**.
- **Relates to:** [ADR-0033](0033-check-governance-and-tamper-evidence-under-an-adversarial-writer.md)
  (the derivation-chain governance this extends to the *measure*), [ADR-0026](0026-auto-merge-router-and-why-the-gate-claim-stays-out-of-the-manifest.md)
  (the lane router + gate-guard this mirrors), [ADR-0032](0032-agentic-development-as-a-tested-boundary.md)
  (the agentic boundary the claim defends), [ADR-0024](0024-verifiable-invariants-single-source-enforced-at-the-boundary.md)
  (invariant sources, which the verdict logic now joins).

## Context

CI today answers one question per commit: did the checks pass *at merge*? But **merged is not
deployable**. A green pull-request lane is a weak, early signal; the strong signals (post-submit on
`main`, nightly, weekly, a canary in production) arrive *later* and lag the merge. Google's TAP draws
this line as `true_head` ≠ `green_head`: the deployable pointer is a separate, **lagging** pointer
advanced only as a commit survives more evidence. QARoom had no such pointer — and three properties of
this specific repo make the naïve "merge ⇒ deployable, red ⇒ revert" model actively unsafe:

1. **Risk is not time.** A tier is a statement about how much evidence a commit survived, not how old it
   is. The ladder is `SUBMITTED → PRESUBMIT_GREEN → POSTSUBMIT_GREEN → NIGHTLY_GREEN → WEEKLY_GREEN →
   CANARY_GREEN`.
2. **QARoom is event-sourced.** A reverted migration, a consumed NATS event, a delivered webhook, or a
   shipped breaking-event (the `verdict→disposition` v2 bump) **cannot be un-emitted**. Auto-reverting
   the *code* leaves the side effect stranded. So revert must be **state-aware**.
3. **The ledger is itself a Goodhart target.** Once "deployable" is a tracked pointer, the cheapest way
   to advance it is not to fix the code but to **relabel a real red as `flaky`** (≈84% of nightly reds
   genuinely are flake, so the relabel hides in the noise) or to **lower a confirmation threshold** so
   nothing is ever called red. The measure must be measured.

## Decision

### 1. `green_head` is a separate, lagging, evidence-derived pointer

`green_head` = the longest **contiguous** commit prefix all `≥` the deploy target tier with **no
outstanding revert**. A single red mid-line caps green_head at the commit *before* it, even when later
commits are individually green — because deploying a later green would carry the intervening red along.
`greenHead(commits, ledger, target)` and `greenHeadLag(...)` are pure functions over the ledger
(`packages/promotion-ledger/src/green-head.ts`), unit-tested including the contiguity-with-revert case.

### 2. The promotion ledger (a sidecar, content-addressed)

An append-only ledger, keyed by `commit_sha`, rows `= (tier, verdict ∈ {green,red,flaky,inconclusive},
evidence_hash, batch_range, culprit_confidence, ts)`. It is the single authority for "is SHA X
deployable at tier T" (`isGreenAtTier`). On disk it is JSONL at `test-results/promotion-ledger.jsonl`
(gitignored, like every test-results artifact); the typed module is **pure** — the caller stamps `ts`
(there is no clock, by convention and because `Date.now()` is unavailable). `evidence_hash` is a stable
content hash of the summary.json envelope, so a verdict **references** the frozen envelope without
touching its schema. A verdict attaches to a **batch range** first; a red then spawns a bisection that
rewrites the range-red into per-commit culprit rows (the O(log n) narrowing is **T24-B**, below).

### 3. State-aware auto-revert (the policy, not the bot)

`classifyChange(files)` classifies a diff as `pure-code | migration | state | contract |
breaking-event`, most-irreversible first, driven off real repo signals (`events/*.v2+.ts`, migration
modules, `packages/contracts/src/machines/` + `spec/`, the Zod/OpenAPI/AsyncAPI/`subjects.ts`
contracts). **Only `pure-code` is auto-revertable.** Every event-sourced class returns
`freeze-and-page`: freeze green_head, page a human, do **not** auto-revert. Test files never carry a
forward side effect, so a test-only edit of a stateful file stays pure-code. The **policy** is encoded
here (and unit-tested); the **bot** that acts on it is T24-B.

### 4. Reward is a trust budget, not a push-gate

Never reward at `PRESUBMIT_GREEN` (the weakest signal). Split **dense steering** (affected-and-severe at
submit) from **sparse accounting** (surviving CANARY/WEEKLY → trust budget). Quarantine-and-confirm
before attributing a red to a commit (the `FLAKE_CONFIRM_RATIO` bar in the verdict logic). This is a
*principle* realized in the verdict thresholds here; the budget ledger itself is T24-B.

### 5. The meta-gate: measure the measure

The verdict logic (`verdict.ts`) is the softest Goodhart target, so it joins the **invariant sources**:
CODEOWNERS over `verdict.ts` / `green-head.ts` / `ledger.ts`, an `invariant-guard` path entry, and a new
`promotion-ledger-guard.yml` that **diffs the verdict logic over commits** — it REDS a threshold
weakened in the loosening direction (`FLAKE_CONFIRM_RATIO` lowered, `MIN_CULPRIT_CONFIDENCE` raised) and
advisorily flags any other verdict-logic edit for a Code-Owner read (mirroring `gate-guard.yml`). The
rot-proof teeth are the falsifiable claim **`relabeled-red-stays-red`**: the toggle
`LEDGER_RELABEL_RED_AS_FLAKY` arms the relabel (a real red → `flaky`), and the in-process meta-gate
(`classifyVerdict` on a deterministic failure must return `red`) reds. `pnpm prove
relabeled-red-stays-red --break` proves it.

## What is T24-A (here) vs T24-B (named, deferred)

**T24-A — built, verifiable in one PR (this ADR):** the `@qaroom/promotion-ledger` package (tier ladder,
content-addressed ledger + `isGreenAtTier` query, `greenHead`, `classifyChange` encoding the
no-auto-revert-on-stateful policy, the governed verdict logic), the `relabeled-red-stays-red` claim +
toggle, the meta-gate workflow, and the CODEOWNERS / invariant-guard governance.

**T24-B — named here, deferred to the live CI (it needs the running pipeline, not in-process code):**

- a **TIA-driven tier map** in `ci.yml` (test-impact-analysis selecting which tiers gate which change);
- the **batch + bisect** job (range verdict → O(log n) culprit narrowing → per-commit ledger rewrite);
- the **auto-revert bot** that acts on `classifyChange` (revert PR for pure-code; freeze + page
  otherwise) — the **policy is already encoded** in the classifier, only the actuator is deferred;
- the **canary** `CANARY_GREEN` promotion from an Argo Rollouts AnalysisRun;
- the **trust-budget reward** ledger (sparse CANARY/WEEKLY-survival accounting).

These are Tier-B because they can only be exercised against a live, multi-stage pipeline; encoding them
in-process would be theater. The Tier-A core is the part that is falsifiable today.

## Consequences

- A deployable-trust pointer now exists and is derived, not asserted; `green_head` lag is observable.
- The auto-revert policy is conservative by construction: it cannot auto-revert an event-sourced change.
- The measure is governed like the invariants it serves; relabelling a red to advance green_head is a
  red check, not a quiet win.
- The ledger is a sidecar: the frozen summary.json envelope is untouched, referenced by content hash.

## Alternatives rejected

- **Reuse the summary.json envelope for verdicts.** Rejected: the envelope is frozen (Commitment 14) and
  is a per-run artifact, not a per-commit deployable-trust pointer. A sidecar keyed by `commit_sha` with
  an `evidence_hash` back-reference keeps the freeze intact.
- **Time-tiers (nightly = "a day old") instead of risk-tiers.** Rejected: age is not evidence; a
  commit's deployability is what it survived, not when it landed.
- **Auto-revert every red.** Rejected: unsafe in an event-sourced system — a reverted migration / consumed
  event cannot be un-emitted (§Context.2).
- **Govern the source but not the measure.** Rejected: that is the exact T23 lesson — the cheapest tamper
  leaves the source pristine and weakens what derives from it; here, the verdict logic IS the derivation.
