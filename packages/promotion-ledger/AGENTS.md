# @qaroom/promotion-ledger

The **green_head / risk-tier / state-aware-revert** core (T24, [ADR-0037](../../docs/adr/0037-promotion-ledger-green-head-and-governed-verdict-logic.md)). A small, pure, dependency-light library — the Tier-A buildable core of the promotion ledger. The CI orchestration that drives it (the tier map, the batch+bisect job, the auto-revert bot, the canary AnalysisRun, the trust-budget reward) is **Tier-B**, named in the ADR, not built here.

## The primitive

`true_head` (the last merged commit) ≠ `green_head` (the deployable pointer). Merged is not deployable; deployable trust is a **separate, lagging** pointer advanced only by tier verdicts. Deploy only from `green_head`.

## Modules

- `tiers.ts` — the promotion ladder `SUBMITTED → … → CANARY_GREEN` (a risk ladder, not a time ladder) + `tierRank`.
- `verdict.ts` — `classifyVerdict`: one tier run's signal → `{green, red, flaky, inconclusive}`. **The softest Goodhart target** (relabel a real red as flaky to advance green_head) and therefore an **invariant source** (CODEOWNERS) measured by the meta-gate. Reads the deliberate-bug toggle `LEDGER_RELABEL_RED_AS_FLAKY`.
- `ledger.ts` — the append-only, content-addressed `LedgerRow` + `append` + `isGreenAtTier` query. A **sidecar** to the frozen `test-results/summary.json` (`evidence_hash` references the envelope, never modifies its schema). On disk: `test-results/promotion-ledger.jsonl` (gitignored). **Pure** — the caller stamps `ts` (no clock here).
- `green-head.ts` — `greenHead`: the longest contiguous deployable prefix; `greenHeadLag`: how far it trails true_head.
- `change-class.ts` — `classifyChange`: `pure-code | migration | state | contract | breaking-event`. Encodes the **state-aware-revert policy**: only `pure-code` is auto-revertable; every event-sourced class freezes green_head + pages (QARoom is event-sourced — a migration / consumed event / delivered webhook cannot be un-emitted).

## The meta-gate ("measure the measure")

The ledger is itself a Goodhart target, so its verdict logic lives under the same governance as the other invariant sources (T23): CODEOWNERS on `verdict.ts` + `green-head.ts` + the manifests, plus `.github/workflows/promotion-ledger-guard.yml` (a diff-over-commits flag mirroring `gate-guard.yml`). The falsifiable teeth are the claim `relabeled-red-stays-red` — `pnpm prove relabeled-red-stays-red --break` arms `LEDGER_RELABEL_RED_AS_FLAKY`, the verdict logic launders a real red into a flake, and the meta-gate (`verdict.test.ts`) reds.

## Conventions

Pure, deterministic, no clock/rng (timestamps passed in). No `any`. Files under 500 lines. The public API is `src/index.ts`; internal modules import each other directly.
