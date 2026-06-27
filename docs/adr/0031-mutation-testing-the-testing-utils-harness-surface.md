# ADR 0031: Mutation-testing the testing-utils harness, one level below the product critical-modules

- **Status:** Proposed
- **Date:** 2026-06-27
- **Records:** the extension of [ADR-0016](0016-testing-your-tests.md)'s mutation-testing discipline from
  the locked product critical-modules **down onto the test harness itself** — the `@qaroom/testing-utils`
  code every other suite is built on. Adds a NEW, SEPARATE Stryker surface
  (`packages/testing-utils/stryker.config.json` + `vitest.stryker.config.ts`, run by
  `scripts/stryker-harness.ts` / `pnpm stryker:harness`); it does **not** modify
  `scripts/stryker-critical.ts` or its locked-6 list. Builds on the determinism trio (Commitment 6),
  scenario replay ([ADR-0015](0015-scenarios-as-first-class-artifacts.md)), and STORY **Pillar 1 —
  severity** (the unit of quality is `P(red | behavior broken)`). Companion ranking:
  [severity-oracle-independence](../severity-oracle-independence.md).
- **Does not modify** [ADR-0001](0001-foundational-decisions.md). It implements more of ADR-0016's
  meta-testing decision, not a new commitment. **Adds no invariant source** and touches none
  (`packages/contracts/**`, `spec/**`, the claim/matrix manifests are untouched — the
  `test-results/summary.json` schema (Commitment 14) is **not** extended; see Deferred).
- **Relates to:** ADR-0016 (the parent: Stryker scoped to the locked-6 product modules),
  [ADR-0024](0024-verifiable-invariants-single-source-enforced-at-the-boundary.md) (single-source
  invariants — the strongest oracle rung), ADR-0015 (the scenario runner this gate mutates).

## Context

ADR-0016 pointed mutation testing at the **product** critical-modules: a surviving mutant there means an
assertionless test of *product* logic. But the suite that proves the product is itself code — fixtures,
the scenario runner, the seeded determinism doubles, the matchers — and ADR-0016 explicitly held the
scenario primitives *out* ("they are test infrastructure, validated by their own unit tests").

That leaves a sharp asymmetry. `@qaroom/testing-utils` carries ~19 test files / ~99 passing tests, all
**un-mutated**. The harness is the one place where a weakened assertion is *maximally* leveraged: a
matcher that silently stops asserting, a fixture that no longer isolates, a `runTwiceAndDiff` that always
reports `identical`, passes its own green suite **and** removes severity from every downstream suite that
trusts it. The thing every other test stands on had no self-check. STORY Pillar 1 makes this the unit of
quality directly: `P(red | behavior broken)` for the harness is exactly what mutation measures, and for
the harness it was unmeasured.

A note on why this is a *separate* surface, not a row added to ADR-0016's list: the locked-6 are
**product** modules whose silent breakage is a production incident, governed as a single source of truth
(adding one is an ADR, removing one a retrospective). The harness is **test infrastructure**; conflating
the two would muddy that governance and let a harness-config edit look like a product-criticality change.
Two surfaces, two configs, two `pnpm` entry points.

## Decision

1. **A new, separate Stryker surface for the harness core.** `packages/testing-utils/stryker.config.json`
   + `vitest.stryker.config.ts`, invoked by `scripts/stryker-harness.ts` (`pnpm stryker:harness`), mirroring
   the per-package shape ADR-0016 established (`inPlace`, `ignoreStatic`, a scoped Vitest `include`, a
   `thresholds.break` floor). It is **independent** of `scripts/stryker-critical.ts`; the locked-6 list is
   untouched.

2. **Bounded to pure, co-located-tested core, so the local run is fast.** The committed `mutate` glob is
   three pure modules — the **scenario runner** (`src/scenario/run-scenario.ts`: `captureScenario` /
   `structuralFingerprint` / `runTwiceAndDiff`) and **two seeded determinism doubles**
   (`src/determinism/seeded-randomness.ts`, `src/determinism/fake-clock.ts`). No PGlite, no
   Testcontainers, so each per-mutant re-run is sub-second and a full bounded pass finishes in ~2s.
   **Measured baseline 2026-06-27: 98.15%** (53 killed / 54; `run-scenario.ts` 100%, `fake-clock.ts`
   100%, `seeded-randomness.ts` 80%). The lone survivor is the `UINT32 - 1` upper-bound off-by-one in
   `seeded-randomness.next()` — a low-value boundary mutant on a 2³² range with no cheap *deterministic*
   kill (the same low-value-literal class ADR-0016 leaves honest rather than chases). `thresholds.break`
   is set to **90**: a floor under the baseline with headroom for that survivor, not a 100% target.

3. **Findings are reified, not papered over (ADR-0016 Decision 4).** The first run surfaced genuine
   assertionless gaps in the harness core, each now reified into a killing test:
   - `structuralFingerprint`'s **bigint branch** was untested — without it `JSON.stringify` *throws*, so
     the determinism oracle would crash on any bigint-bearing outcome rather than compare it.
   - `structuralFingerprint`'s **`Array.isArray` branch** was untested — an array and `{0:…,1:…}` could
     collapse to one fingerprint, letting the oracle call two structurally-different outcomes identical.
   - `FakeClock`'s **entire `set()` body** plus its default-instant and `Date`-instance constructor
     branches were uncovered — a no-op `set()` would have passed every existing test.

4. **Governance, mirroring ADR-0016.** Adding a module to the *harness* mutation surface is recorded in an
   ADR (this one, or a successor); removing one wants a note on why the meta-test is no longer worth its
   cost. The broader harness surface is named below, not silently in scope.

5. **The full harness pass is a dispatched lane.** The pglite fixture (`harness/pglite.ts`,
   `setup-service-test.ts`), migration discipline (`harness/migration-discipline.ts`), and the matchers
   are the nightly/dispatched extension — they need PGlite per mutant (slow) or, for the matchers, a
   guard they do not yet have (see the finding below). `pnpm stryker:harness` stays the fast, bounded,
   PR-affordable gate.

## Consequences

### Positive
- The harness now has the same self-check the product modules got: a weakened fixture/runner/double
  assertion can no longer pass invisibly and launder a false green into every suite that depends on it.
- The bounded run is genuinely fast (~2s), so it is cheap to dispatch and cheap to keep honest.
- Three real assertionless gaps in the determinism scaffolding were found and closed on the first pass —
  the lane paid for itself immediately, exactly as ADR-0016 reports the product lane did for `lamport.ts`.

### Trade-offs accepted
- One tolerated survivor (the `UINT32 - 1` boundary) keeps `seeded-randomness.ts` at 80% and the package
  baseline at 98.15% rather than 100%. Chasing it would mean asserting an exact RNG draw at the 2³²
  boundary — brittle and low-value. The `break = 90` floor records this honestly.
- A second Stryker surface is one more config pair to keep alive. Accepted: the governance clarity of
  *product vs. test-infrastructure* is worth more than the saved file.

### A named finding, not yet fixed: the matchers have no co-located guard
The matchers (`matchers/rfc7807.ts`, `matchers/lamport.ts`, `matchers/polling.ts`,
`matchers/capabilities.ts`) are assertion helpers exercised only **indirectly**, across service suites —
they carry **no co-located `*.test.ts`**. A weakened matcher is therefore the highest-leverage
assertionless risk in the whole harness, and it cannot be meaningfully mutation-gated until it has a
direct unit guard (an all-survived score would be an artifact of the missing local test, not a real
floor). **First backfill target** before the matchers join this surface.

## Deferred (named, out of this slice)
- **Diff ratchets** — patch-coverage on push, changed-line mutation nightly. These need the governance
  ledger and CI tiering tracked in STORY's other pillars (T23/T24); without them a per-PR mutation budget
  has nowhere to anchor. Not built here.
- **`flake_rate` / per-test severity fields** in `test-results/summary.json` — the schema is **frozen**
  (Commitment 14, ADR-0001). A severity/flake field is a deliberate schema change behind its own ADR and
  Code-Owner sign-off; the flake posture (quarantine vs. hard-red) is deferred with it. This slice folds
  **nothing** new into `summary.json` — the harness report lands in `test-results/stryker-harness/`,
  deliberately outside the `test-results/stryker-*.json` glob `scripts/stryker-results.ts` folds, so the
  two surfaces never bleed into one envelope.
- **The full harness mutation pass** (pglite fixture, migration discipline, the matchers) — a dispatched
  nightly lane per Decision 5, gated on the matchers backfill above.

## Related decisions
- [ADR-0016] the parent: Stryker scoped to the locked product critical-modules; this extends it down onto
  the harness. Decision 1 (scoped, never full-suite) and Decision 4 (reify findings) are inherited.
- [ADR-0015] scenarios as first-class artifacts: the scenario runner mutated here is its engine.
- [ADR-0024] single-source invariants — the rank-5 oracle in the companion
  [severity-oracle-independence](../severity-oracle-independence.md) ranking.
- [ADR-0001] Commitments 6 (determinism — the doubles mutated here) and 14 (the frozen test-results
  schema — why the flake field is deferred).
