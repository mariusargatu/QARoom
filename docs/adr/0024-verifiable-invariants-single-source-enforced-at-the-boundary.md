# ADR 0024: Verifiable invariants — one definition, derived at every enforcement boundary

- **Status:** Accepted
- **Date:** 2026-06-20
- **Relates to:** ADR-0001 (Commitment 6, determinism seams; Commitment 9, tenancy), the
  falsifiable-claims machinery (`scripts/prove.ts`, `scripts/lib/manifests/claims.ts`) and the
  detection matrix (`scripts/detection-matrix.ts`). This is an *experiment* on the
  `experiment/verifiable-invariants` branch, not a fleet migration.
- **Records:** the decision to take a load-bearing invariant from *tested-by-sampling* to
  *enforced-from-a-single-definition*, so the rule lives in exactly one place and every
  enforcement point is derived from it — never a parallel restatement an agent can quietly weaken.

## Context

QARoom's thesis is "testability as an architectural property." One sharp edge of that is whether a
business invariant is **stated once and enforced everywhere by derivation**, or **restated by hand
in each layer** (request schema, DB, generator, docs) where the copies can silently drift apart.

The worked example is the vote-value rule: **a vote is exactly +1 or -1.** Before this change:

- `packages/contracts/src/vote.ts` defined `VoteValue = z.literal(1) | z.literal(-1)` — but only the
  HTTP request body was validated against it.
- `services/content/src/db/schema.ts` stored `value: integer(...)` with **no** constraint. A value
  of `7` could enter the table, and `score = sum(value)` would propagate it into the post score.
- `packages/testing-utils` re-stated the rule a **second** time as `fc.constantFrom(1, -1)` — a hand
  duplicate that could drift from the schema.
- `castVote(... value: number)` accepted a bare `number`, so the internal seam was unityped.

So the rule was *assumed* at three of four layers and *enforced* at one. That is exactly the failure
mode an agent (or a tired human) can collapse: loosen the schema and nothing else complains.

## Decision

Define the invariant **once** and **derive** every enforcement point from that single definition.

`packages/contracts/src/vote.ts` is the single source:

```ts
export const VOTE_VALUES = [1, -1] as const          // THE definition
export const VoteValue = z.union([z.literal(1), z.literal(-1)])   // boundary + OpenAPI
export function voteValueCheckSql(column: string)    // DB CHECK predicate, derived
  { return `${column} IN (${VOTE_VALUES.join(', ')})` }
```

Derived enforcements, all pointing back at `VOTE_VALUES`:

1. **HTTP boundary + OpenAPI.** `CastVoteRequest` already `.parse()`s `VoteValue` in the route, and
   the OpenAPI document is built from the same Zod registry (`contract/operations.ts`). No change to
   the wiring; it was already derived.
2. **DB CHECK at the real boundary.** `votes_value_check CHECK (value IN (1, -1))` — built from
   `voteValueCheckSql('value')` in both the drizzle table definition (`db/schema.ts`) and the
   migration DDL (`db/migrate.ts`, inline on CREATE plus an idempotent guarded ALTER for already-
   deployed tables). The database now rejects an out-of-range value even if a caller bypasses Zod.
3. **Typed internal seam.** `castVote(... value: VoteValueT)` — the `7` is unrepresentable at the
   repository seam, not just at the edge.
4. **Property generator.** `voteValueArb = fc.constantFrom(...VOTE_VALUES)` in
   `@qaroom/testing-utils` — the former hand duplicate now derives from the same constant.
5. **Property test against real code.** A `test.prop` in
   `services/content/src/repository/votes.test.ts` drives the **real** `castVote` against the
   **real** PGlite DB (same Postgres engine, same CHECK) and asserts the ±1 membership,
   `score == upvotes − downvotes`, and `|score| <= distinct voters`. It also cross-checks every drawn
   arbitrary value against `VoteValue.parse`, binding the generator to the schema so they cannot
   drift. (It lives in the existing `votes.test.ts` rather than a new `*.property.test.ts` so it
   reuses that file's per-test PGlite: `pnpm test` caps worker concurrency at 50% of cores and the
   PGlite-heavy property suites sit at the timeout edge under full fan-out — a separate file added a
   concurrent worker that tipped a neighbouring suite past its timeout. Same coverage, no new worker.)
6. **Binding test.** `packages/contracts/src/vote.test.ts` pins `VoteValue` to accept exactly
   `VOTE_VALUES`, so the readable literal union and the derived constant describe the same set.

### Empirical falsifier (no guarantee we can't break is trustworthy)

Following the repo's deliberate-bug pattern, `CONTENT_BUG_VOTE_OUT_OF_RANGE` (read once in
`config/faults.ts`, injected as `FaultConfig.voteOutOfRange`) makes `castVote` write an out-of-range
value. The DB CHECK rejects it and the property test goes red. It is wired as the permanent claim
**`vote-value-in-band`** (`pnpm prove vote-value-in-band --break`) and as detection-matrix toggle
`vote-out-of-range`. The matrix records a *second* independent catcher: any test that casts a vote
also reds under the toggle (constraint violation), which is the point — the DB is now a real guard.

## On zod-fast-check

The brief suggested `zod-fast-check` as the schema→arbitrary bridge. We did **not** add it: that
library pins zod 3 / fast-check 3, and the repo is on **zod 4 / fast-check 4** (incompatible). More
importantly, a bridge would introduce a *second* derivation engine. Deriving the arbitrary from the
shared `VOTE_VALUES` constant — and cross-checking each drawn value against `VoteValue.parse` in the
property test — gives the same one-definition guarantee with no new dependency and no new drift
surface. This is consistent with the repo's existing convention (hand-built arbitraries in
`testing-utils/generators` that reference the contracts schemas).

## What is proven vs sampled (no overclaiming)

- **Enforced (not sampled):** the ±1 rule at the **database** (a CHECK constraint either holds for
  every row or the write fails) and the **type system** (`VoteValueT` at the seam). These are total
  over their domain.
- **Sampled (property test):** the score-reconciliation corollary and the schema↔generator binding
  are exercised over fast-check's sample (10 runs), not exhaustively. Strong evidence, not proof.
- **Falsifiable:** the whole chain is empirically falsifiable via `CONTENT_BUG_VOTE_OUT_OF_RANGE`.

## Consequences

- Changing the vote-value rule now means editing `VOTE_VALUES` in one file; the DB constraint, the
  validator, the OpenAPI doc, the generator, and the property test all follow. Per the experiment's
  non-negotiable rule, **the invariant source is not edited to make a check pass** — a change there
  is a deliberate decision requiring its own review (see Phase 4 guardrails: CODEOWNERS on
  `packages/contracts/**`).
## Phase 2 — CrossHair over the Python moderator decision function

The moderator's `self_check` (`workflow/selfcheck.py`) is pure and deterministic, so its two safety
guarantees can be checked by **symbolic execution**, not just sampling:

- **Abstain (FR5):** a draft below the abstain threshold escalates to a human.
- **Approve guard (FR-safety):** a final `approve` never departs from the retrieved precedent — a
  departing approve escalates instead of auto-shipping.

`src/moderator_agent/verify/selfcheck_contracts.py` expresses each as a PEP-316 docstring contract
(`pre:` / `post:`) over a thin wrapper that calls the **real** `self_check` (imported, not
re-implemented) and reads the deliberate-bug toggles from the same `Settings()` production uses. The
pydantic verdict is built with `model_construct` (no validation) so CrossHair explores the plain
symbolic fields instead of stalling inside pydantic-core, which it cannot see through.

`pnpm moderator:verify` runs `crosshair check` on the guarded path — **no counterexample within
budget**. `pnpm moderator:verify --falsify` arms each `MODERATOR_DISABLE_*` toggle and asserts
CrossHair surfaces a **concrete** counterexample (a toggle that produces none would be theater).
Confirmed both ways:

- guarded: clean (exit 0).
- `MODERATOR_DISABLE_ABSTAIN=1` → counterexample `abstain_escalates_low_confidence(0.0, 'remove', …)`.
- `MODERATOR_DISABLE_APPROVE_GUARD=1` → counterexample `never_confidently_approves_flagged(0.5,
  'approve', True, [], 0.25)` (ships a departing approve).

**Bounded, not a total proof.** CrossHair reports "no counterexample found within
`--per_condition_timeout`", a budget-limited search, not exhaustive verification. Budgets: 20 s/
condition for the guarded gate (resolves well inside it); 45 s/condition for the approve-guard
falsifier, which is slower because CrossHair must symbolically solve `disposition == 'approve'`
together with the divergence and threshold constraints. Kept **off the blocking `pnpm verify`** lane
for now (it needs `uv` + the `crosshair-tool` dev dep); run it explicitly or wire it into the
moderator CI lane later. It corroborates the existing `moderator-abstain` and
`moderator-no-confident-approve-of-flag` claims with a *different* method (symbolic vs example-based).

## Phase 3 — TLA+ for the at-least-once webhook delivery protocol (spike)

A concurrency invariant the type system cannot express: every webhook delivery reaches a terminal
state and no event is lost, under all interleavings of attempt / fail / retry / exhaust / crash.

`spec/tla/WebhookDelivery.tla` (+ `.cfg`, `README.md`) models one delivery's committed lifecycle —
the projection of the worker (`services/webhooks/src/worker.ts`) and the hand-authored XState machine.
The in-memory `AttemptStarted → Delivering` leg is not persisted, so a crash before the DB commit
leaves the row re-claimable (the transaction rolls back) — at-least-once. Invariants: `TypeOK`,
`NoSilentDrop` (`Delivered` only after a real 2xx), `ExhaustionLegit` (`DeadLettered` only at budget),
`NoStuckDelivery` (a non-terminal delivery always has `Attempt` enabled), and the temporal
`EventuallyTerminal`. `MaxAttempts = 8` mirrors `WEBHOOK_RETRY_POLICY.max_attempts`.

**Checked with TLC** (`tla2tools` v1.8.0): *"Model checking completed. No error has been found"* over
the full state space (17 states, depth 9). The spec-level falsifier — a commented `DropOnFail` action,
the model twin of `CHAOS_WEBHOOK_DROP_ON_FAIL` — was confirmed to make TLC report *"Invariant
NoSilentDrop is violated"*, so the model is falsifiable the same way the code is.

**Bound to the code, not parallel.** `services/webhooks/src/delivery-invariant.ts`
(`assertLegalDeliveryCommit`) is the persisted-state projection of the model's `Next` relation (legal
edge + `ExhaustionLegit`). The worker calls it before **every** `persist(...)`, so an off-protocol
commit throws at the real boundary. It is *structural*, so it never fights the semantic chaos demos
(those produce structurally-legal commits; the at-least-once property catches the semantic drop) —
confirmed: all 83 webhooks tests pass with the assertion wired in, and `pnpm prove
webhook-at-least-once --break` is still red.

The spec itself is **off the blocking CI path** (a design-time spike; TLC is not in the gauntlet); the
runtime binding is on the normal path. See `spec/tla/README.md` for TLC / Apalache run instructions.

## Phase 4 — guardrails (so the invariants stay honest)

Three layers keep an agent (or a hurried human) from quietly weakening an invariant source:

- **`.github/CODEOWNERS`** assigns `@mariusargatu` to the invariant sources — `packages/contracts/**`,
  `spec/**`, the falsifiable-claim + detection-matrix manifests, and the immutable ADR-0001. To make
  the review *required*, the owner enables "Require review from Code Owners" in branch protection for
  `main` (a Settings action, noted in the CODEOWNERS header); the file itself is the assignment.
- **`.github/workflows/invariant-guard.yml`** — an advisory, non-blocking PR workflow (paths-filtered
  to the same sources). It prints the diff and emits a `::warning` per touched file reminding the
  reviewer that invariant sources need an ADR + Code Owner sign-off. Like `pages.yml` it runs **no**
  build/test lane, so the dispatch-only discipline on `ci.yml` stays intact.
- **AGENTS.md → "Invariant sources"** — the cultural rule in the file every agent reads first: never
  weaken an invariant/schema/constraint/spec to make a red go green; one definition derived
  everywhere; a change to an invariant source is a deliberate, ADR-gated decision.

The `moderator:verify` CrossHair gate (Phase 2) is recorded in the `census.ts` ALLOWLIST with a stated
reason (deliberately off the blocking lane), so the orphan-gate reports it rather than failing.

## Status of the experiment

All four phases landed on `experiment/verifiable-invariants`. Three verification methods now span the
stack, each at the altitude its invariant lives at and each bound to real code + falsifiable:
derivation + property test (vote ±1, Phase 1), symbolic execution (moderator `self_check`, Phase 2),
and model checking (webhook delivery protocol, Phase 3) — with Phase 4 the guardrails that keep the
sources honest.

## Rejected alternatives

- **Leave the DB unconstrained, trust the request schema.** The original state; one bypass (an
  internal caller, a future endpoint, a bad migration) and a `7` is in the score. Rejected.
- **Add `zod-fast-check`.** Version-incompatible and a second derivation engine. Rejected (above).
- **A lint rule that greps for stray `1`/`-1`.** Catches the symptom (duplication), not the cause
  (no single source). Derivation removes the duplication structurally. Rejected.
- **Migrate the contract layer to Effect (Effect Schema).** Effect is where this pattern is heading
  in TypeScript — schema as source of truth plus typed errors, dependency injection, and concurrency
  primitives with real guarantees — and it serves the "testability as an architectural property"
  thesis almost directly. Rejected *for now*, on two grounds. (1) It is a migration, which violates
  this experiment's constraints (small reversible diffs; deepen Zod/fast-check/drizzle rather than
  introduce a framework; per the locked-vs-open rule a contract-layer swap needs its own ADR, not a
  rider here). (2) QARoom already has hand-built equivalents of Effect's three selling points —
  typed errors (RFC 7807 Problem Details, lint-enforced), DI (the injected `Clock`/`IdGenerator`/
  `Randomness` + `FaultConfig` determinism seam, Commitment 6), and concurrency guarantees (advisory
  locks + `SELECT … FOR UPDATE` + the transactional outbox + dedup). Adopting Effect would
  *consolidate* working, tested infrastructure under one library, not buy a new guarantee for this
  invariant: the teeth here are the DB CHECK and the falsifier, both outside Effect's reach (it does
  not emit SQL constraints), and Phases 2–3 live in Python (CrossHair) and TLA+. Deepening Zod gets
  ~90% of the value at near-zero disruption.

  **"Effect later" trigger conditions** (so the decision is falsifiable, not taste). Revisit when ≥2
  of these bite: (a) typed-error plumbing is hand-rolled across service boundaries in >3 places and
  drifts; (b) the DI/determinism seam needs effect-tracking (which dependencies a code path touches)
  that the type system cannot express; (c) async orchestration (saga / cross-service compensation)
  outgrows the outbox + XState machines; (d) you want `Schema` ↔ runtime validation ↔ test arbitrary
  as a *single* artifact and the derive-from-a-shared-constant trick (used here) stops scaling. None
  hold as of this ADR; Phase 1 hit no Zod ceiling (the zod-fast-check incompatibility was routed
  around by deriving from `VOTE_VALUES`; the `z.union` tuple-typing was cosmetic).
