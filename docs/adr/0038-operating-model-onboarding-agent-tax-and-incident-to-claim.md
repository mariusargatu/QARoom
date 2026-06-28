# ADR 0038: The operating model — onboarding gradient, agent-absorbs-the-triangulation-tax, and the incident→claim loop (T25/T04)

- **Status:** Proposed
- **Date:** 2026-06-28
- **Records:** the decision to make the discipline this repo encodes *livable* — to re-axis the docs by
  **derivability** (not by reader), to ship a **getting-started gradient** + **add-a-field recipe** so a
  new contributor or agent can land a change without reverse-engineering the triangulation tax, to write
  down the **incident→claim ritual** (a postmortem yields a falsifiable claim card), and to fix the
  **agent reward** as a dense/sparse split keyed on the promotion ledger ([ADR-0037](0037-promotion-ledger-green-head-and-governed-verdict-logic.md)),
  never at presubmit. It also adds the **one-location-invariant drift gate**: a tracked count has one
  editable home, and a hand-typed restatement elsewhere that disagrees is a red check.
- **Does not modify** [ADR-0001](0001-foundational-decisions.md). It **touches no invariant source**:
  it edits no `claims.ts` / `detection-matrix.ts` / `boundary-registry.ts` / `spec/**`, adds no schema,
  no toggle, no runtime behaviour, and **no new claim** (the incident→claim worked example reuses the
  existing `consumer-lag-bounded` claim rather than manufacture a synthetic one — adding a claim purely
  to demonstrate the ritual would be the theater this card deletes). It is additive docs + one census
  check (the one-location gate) + an AGENTS.md thinning. Its only mechanical contract is the existing
  drift gates (`pnpm census`, `pnpm claims:verify`, `pnpm links:check`).
- **Relates to:** [ADR-0030](0030-checking-architecture-in-service-of-a-testing-mission.md) (the
  derivability philosophy and the front-door reframe this realizes — the WHY belongs in an ADR, the
  derived landscape in ARCHITECTURE.md), [ADR-0037](0037-promotion-ledger-green-head-and-governed-verdict-logic.md)
  (the promotion ledger the reward model keys on), [ADR-0024](0024-verifiable-invariants-single-source-enforced-at-the-boundary.md)
  (the derive-from-one-source discipline the one-location gate extends from code into the docs),
  [ADR-0034](0034-observability-hardening-pii-free-spans-consumer-lag-slo-and-alert-rule-testing.md)
  (the SLO→alert one-source that "tested SLO = alerted SLO" ties to). The companion prose is
  [docs/operating-model.md](../operating-model.md), [docs/getting-started.md](../getting-started.md),
  [docs/add-a-field.md](../add-a-field.md), [docs/incident-to-claim.md](../incident-to-claim.md), and
  [docs/reward-model.md](../reward-model.md).

## Context

[ADR-0030](0030-checking-architecture-in-service-of-a-testing-mission.md) named what QARoom is and named
its costs (the change-amplification tax, the oracle problem, the agent-attacks-the-gates risk). A name
and a cost list are not an operating model. Three gaps remained:

1. **The docs were axed by *reader* (the human guide, the agent guide), not by *need*.** That invites the
   same rot the whole repo fights: prose that *restates* what a schema or a lint rule already says drifts
   the moment either changes, and an agent reading the prose walks into the stale copy. The
   [Diátaxis](https://diataxis.fr/) split is by need, and the sharper QARoom split is by **derivability**:
   - **Layer 1 — non-derivable narrative (the WHY).** ADRs, getting-started. Hand-authored, kept *small*,
     because nothing generates it. This is where judgment lives.
   - **Layer 2 — derived machine-context (the WHAT).** Schema, manifests, the lint plugin, the census,
     the README/ARCHITECTURE blocks rendered from `summary.json`. 100% generated, drift-gated. **The lint
     rule IS the spec**; a prose "must" that merely restates it is debt.
   AGENTS.md had become an encyclopedia restating Layer-2 facts. The fix is to make it a **thin router**
   to executable truth: point at the lint plugin, the manifests, the drift gates, and the Layer-1 ADRs —
   and stop re-typing the WHAT.

2. **The triangulation tax had no on-ramp.** One field added to a request touches the Zod schema, the
   regenerated OpenAPI, the consumer Pact, the property generator, maybe an XState model — five edits for
   one idea ([operating-model.md](../operating-model.md) §1). A newcomer (human or agent) had to
   reverse-engineer that from the conventions. A *worked gradient* — one schema change threaded through
   every derived artifact, pointing at the generators that do the mechanical mass — turns the tax from a
   surprise into a recipe.

3. **The reward and the feedback loop were named in [ADR-0037](0037-promotion-ledger-green-head-and-governed-verdict-logic.md)
   but not written down as an operating ritual.** *Where does a new check come from?* — a postmortem.
   *When does an agent get rewarded?* — never at presubmit; only when a commit survives the lagging tiers.
   Both needed a one-page, worked statement.

## Decision

### 1. Re-axis the docs by derivability (Layer 1 vs Layer 2)

The docs are organized by what *generates* them, not by who reads them:

- **Layer 1 (narrative, hand-authored, small):** `docs/adr/**`, `docs/getting-started.md`,
  `docs/operating-model.md`, this family. The non-derivable WHY.
- **Layer 2 (derived, drift-gated):** the Zod contracts → OpenAPI/AsyncAPI, the
  `scripts/lib/manifests/**`, `tools/eslint-plugin-qaroom`, the census, the ARCHITECTURE.md
  stats/claims/cost/boundaries blocks rendered by `scripts/render-*.ts` and byte-gated by
  `claims:verify`. The WHAT, never hand-typed.

**The decision rule:** *a fact that can change without a gate firing does not belong in Layer 2.* Every
"must" in AGENTS.md is now either backed by a gate (and the doc points at the gate instead of restating
the rule) or named honestly as a gap. AGENTS.md is a router; `CLAUDE.md` stays a symlink to it.

### 2. The one-location-invariant drift gate (census check b4)

The derive-from-one-source discipline ([ADR-0024](0024-verifiable-invariants-single-source-enforced-at-the-boundary.md))
applied to the docs themselves: a **tracked count** (services, packages, ADRs, boundaries, falsifiable
claims) has exactly ONE editable home — the stats block (`scripts/render-stats.ts`, byte-gated by
`claims:verify`) and the manifests it derives from. `scripts/census.ts` check **b4** scans the
front-door landscape docs and reds on any *definite* restatement of one of those counts that disagrees
with the derived source. Hedged approximations (`~12`, `about 24`) are prose, not a second home, and are
skipped; the byte-gated render blocks are skipped (they are the count's canonical home). The gate's
teeth are `scripts/census.test.ts`: an out-of-band edit of a tracked number reds it. (It caught a live
one on landing: ARCHITECTURE.md said "All 23 ADRs" against a derived 37.)

### 3. The getting-started gradient + add-a-field recipe (Layer-1, small)

[docs/getting-started.md](../getting-started.md) is "your first feature": one worked schema change — add
an optional field to a donation — threaded through Zod → `pnpm openapi:generate` → the derived artifacts,
pointing at the existing generators rather than re-describing them. [docs/add-a-field.md](../add-a-field.md)
is the mechanical recipe: edit the Zod source, regenerate, scaffold the Pact + property stub, and **stop
at the judgment review** — the recipe runs the spec-derived mass and hands the irreducibly-human part
(the oracle, the threat model) back to the contributor. The agent absorbs the triangulation tax; the
human spends scarce judgment on the part no generator can do.

### 4. The incident→claim ritual

[docs/incident-to-claim.md](../incident-to-claim.md) writes down the feedback loop: a postmortem yields a
**falsifiable claim card** — a manifest entry + a deliberate-bug toggle + a gate that reds under it — but
only when the finding is *load-bearing ∧ falsifiable ∧ source-derived*. The worked example is the
existing `consumer-lag-bounded` claim (a stalled consumer = a silent failure mode turned into a defined,
caught one), shown end-to-end through its manifest entry, its `CHAOS_CONSUMER_STALL` toggle, and its gate
— with the SLO it bounds derived from the same `CONSUMER_LAG_SLO` source as the alert. No synthetic claim
is added: the ritual is demonstrated against a real one, and `pnpm prove consumer-lag-bounded --break`
proves the teeth.

### 5. Reward = trust budget, keyed on the ledger; tested SLO = alerted SLO

[docs/reward-model.md](../reward-model.md) fixes the agent reward as a **dense/sparse split** keyed on
[ADR-0037](0037-promotion-ledger-green-head-and-governed-verdict-logic.md): **dense steering** =
affected-and-severe at submit (signal, not reward); **sparse accounting** = surviving CANARY/WEEKLY →
trust budget, derived from the promotion ledger's `green_head` / tier verdicts. **Never reward at
presubmit** (the weakest signal); **quarantine-and-confirm** before attributing a red to a commit. And
"**tested SLO = alerted SLO**": the alert thresholds derive from `SLO_TARGETS` / `CONSUMER_LAG_SLO`
([ADR-0034](0034-observability-hardening-pii-free-spans-consumer-lag-slo-and-alert-rule-testing.md)), so
a bound you can test is a bound you are paged on — one source, two projections.

## Consequences

- The docs have a stated axis (derivability), so "where does this fact live?" has one answer, and the
  AGENTS.md thin-router rework has a principle behind it rather than taste.
- A new contributor or agent can land a field-addition from the getting-started gradient without
  reverse-engineering the tax; the recipe stops at the judgment review by design.
- The one-location gate closes a real drift class (a hand-typed total drifting from the derived count),
  with falsifiable teeth — extending [ADR-0024](0024-verifiable-invariants-single-source-enforced-at-the-boundary.md)
  from code into prose.
- The reward model is honest about *when* trust is granted (lagging survival, never presubmit), so an
  agent cannot farm a green presubmit tick into merge-rate.

## Rejected alternatives

- **Add a synthetic incident→claim to bump the claim count.** Rejected: a claim manufactured only to
  demonstrate the ritual is exactly the theater [ADR-0030](0030-checking-architecture-in-service-of-a-testing-mission.md)
  and T25 exist to remove. The ritual is shown against a real, already-falsifiable claim.
- **Keep restating conventions as prose in AGENTS.md.** Rejected: a "must" without a gate is debt, and a
  "must" *with* a gate that re-types the rule drifts from it. The router points at the gate.
- **Make the one-location gate flag every number in every doc.** Rejected: false-positive noise (a subset
  "4 claims", an approximate "~24 techniques"). It pins only *definite restatements of the five tracked
  totals*, outside the byte-gated home, un-hedged.
- **Reward at presubmit (fast feedback).** Rejected: presubmit-green is the weakest signal and the easiest
  to game; the ledger rewards only lagging-tier survival ([ADR-0037](0037-promotion-ledger-green-head-and-governed-verdict-logic.md) §4).

## Invariant-source note

This ADR is deliberately **outside** the invariant-guard surface: it edits no covered path
(`packages/contracts/**`, `spec/**`, the claims/detection-matrix manifests, ADR-0001), introduces no new
enforced "must" prose, and adds no claim. Its discipline is that every relative link it adds resolves
(`pnpm links:check`), every doc-cited script exists and every tracked count has one home (`pnpm census`),
and the stats line stays byte-exact after the ADR-count bump (`pnpm claims:verify`).
