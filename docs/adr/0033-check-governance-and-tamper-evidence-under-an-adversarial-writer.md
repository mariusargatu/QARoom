# ADR 0033: Check governance and tamper-evidence under an adversarial writer (T23)

- **Status:** Proposed
- **Date:** 2026-06-27
- **Records:** the decision to govern QARoom's CHECKS — not just its source invariants — as a
  three-tier trust model, on the premise that the agent attacks the GATES, not only the product.
  [ADR-0032](0032-agentic-development-as-a-tested-boundary.md) made agentic development a boundary and
  scaffolded three claims; it explicitly named the tamper-evidence layer ("CODEOWNERS over the
  derivation chain + signed gate evidence") as **T23, deferred**. This ADR builds the buildable core of
  that layer.
- **Does not modify** [ADR-0001](0001-foundational-decisions.md). It is purely additive: two new
  falsifiable claims, two deliberate-bug toggles, CODEOWNERS / invariant-guard / gate-guard extensions,
  and three orchestration gates. It **weakens no existing claim, schema, gate, or falsifier** — per the
  repo's invariant rule, a red introduced here is a real finding to fix, never a rule to loosen.
- **Relates to:** [ADR-0032](0032-agentic-development-as-a-tested-boundary.md) (the boundary this
  hardens), [ADR-0024](0024-verifiable-invariants-single-source-enforced-at-the-boundary.md) (the
  single-source invariants whose *derivation chain* this governs), [ADR-0026](0026-auto-merge-router-and-why-the-gate-claim-stays-out-of-the-manifest.md)
  (gate-guard, here strengthened with gate↔target pairs), [ADR-0016](0016-testing-your-tests.md) /
  [ADR-0031](0031-mutation-testing-the-testing-utils-harness-surface.md) (mutation as the defender of
  assertion strength, the engine behind the adversarial taxonomy).

## Context

The threat model FLIPS. The agent is not (only) a careful author shipping a correct change past honest
checks; it is an **untrusted writer whose output targets the verifier itself**, and that is measured,
not assumed:

- **ImpossibleBench (2026):** GPT-5 cheated **76%** of the time — editing tests, overriding `__eq__` to
  return `True`, special-casing the exact checked input.
- **METR:** o3 **monkey-patched the grader** rather than solving the task.
- **Anthropic:** models reach for `sys.exit(0)`; in one run **sabotaged the reward-hack detector 12%**.

ADR-0032 modelled this at the gate layer (three claims, three named attacks). But three holes remained,
and a Phase-0 spike (`planning/spikes/t23-tamper-evidence`, mapped onto the **real** vote `±1` invariant
— `VOTE_VALUES`, `CONTENT_BUG_VOTE_OUT_OF_RANGE`) made each concrete:

- **C3 — the derivation-chain hole.** ADR-0024 CODEOWNS the *source* (`VOTE_VALUES`). But the cheapest
  tamper leaves the source pristine and weakens what DERIVES from it (the property generator, the
  mutation config, the prove harness). The spike weakened the deriver to a `[-2, 2]` range while the
  source stayed `[1, -1]`; the source-only guard never saw it and the `+2` bug passed.
- **C6 — projection is a severity decision.** The author's falsifier wrote a `±7` — out of *range* and
  out of *set*. A range-projected falsifier catches it; but it MISSES an adversary's `0`, which is
  *in* the range `[-1, 1]` and only *out of* the set `{1, -1}`. The author plants the mutant they
  imagined, so `prove --break` must be **adversarial**, not author-seeded.

## Decision: a three-tier check-governance model

Checks are not all equally trustworthy, so they are not all governed the same way:

| Tier | What | Governance | Grows |
|---|---|---|---|
| **0 — Falsifiers** | the human-authored, agent-independent anchor: a planted bug MUST red a named gate | human-only; the trust anchor | slowly, deliberately |
| **1 — Invariants** | Zod / TLA+ / `VOTE_VALUES` single sources | agent-immutable (CODEOWNERS + invariant-guard) | slowly |
| **2 — Checks** | the agent-owned gate body (generators, mutation config, prove harness, conformance checks) | defended by **differential ratchets**, not immutability | freely |

The four corrections this ADR implements:

### 1. Govern the derivation CHAIN, not just the source

The Zod / `VOTE_VALUES` source was already codeowned; the code that DERIVES from it was not. So
CODEOWNERS + invariant-guard now also cover the **property generators**
(`packages/testing-utils/src/generators/**`), the **agentic gate bodies**
(`packages/testing-utils/src/agentic/**`), the **mutation config**
(`scripts/stryker-{critical,harness}.ts`, `**/stryker.config.json` — mutated paths + survival
threshold), and the **prove/teeth harness** (`scripts/prove.ts`, `prove-adversarial.ts`,
`claims-verify.ts`, `deriver-conformance.ts`, `lib/claim-evidence.ts`). A new
**deriver-conformance gate** (`scripts/deriver-conformance.ts` + the `deriver-conformance` claim)
recomputes the `±1` set straight from `VOTE_VALUES` and samples the live arbitrary: a deriver weakened
while the source stays pristine (the C3 attack, toggle `AGENT_WEAKEN_VOTE_DERIVER`) reds it — by
observing real output, so a hand-edit that swaps the generation engine is caught the same way the
toggle is. gate-guard now also flags **gate↔target pairs** (a gate edited in the same diff as the exact
thing it checks), the precise one-move tamper.

### 2. Make `prove --break` adversarial

Author-planted mutants are a selection effect. `pnpm prove:adversarial`
(`scripts/prove-adversarial.ts` + `adversarial-taxonomy.ts`) seeds the mutants from the **named
taxonomy** — `equals-true` / `exit-zero` (oracle-side, caught by mutation kill ratio) and
`special-casing` / `state-recording` (impl-side, caught by a property over fresh inputs) — and asserts
each is BOTH real theater (a weak check greens it) AND caught by its designated gate.

### 3. Invest in the weak-oracle surface

The formalizable `5%` (the DB CHECK, the round-trip spec) is already strong. The leverage is the
weak-oracle surface — property / metamorphic / differential. The C6 fix is exactly this: the new
`vote-value-in-set` claim (toggle `CONTENT_BUG_VOTE_OUT_OF_SET`, writes `0`) is the **set-membership**
projection of the same `VOTE_VALUES` source, and it catches the in-range/out-of-set adversary a range
falsifier waves through. The impl-side half of the adversarial taxonomy is the same investment.

### 4. Binding + signed — and the honest residual

Branch protection on `main` now requires a PR + Code-Owner review + the `verify` / `review` checks, so
the CODEOWNERS and gate-guard teeth are **binding for non-admins**, not merely advisory. The honest
residual, stated plainly (STORY open problem 4): `enforce_admins:false` (an admin can still bypass), a
**separately-credentialed CI identity** that owns the oracle, and **SLSA / sigstore-signed gate
evidence** are all still future. Any gate that remains advisory (invariant-guard, gate-guard,
agent-controls) is labelled "advisory social gate" in its own header, honestly.

## The C6 finding: projection choice IS a severity decision

This is a **Tier-1 candidate finding**, not a footnote. The same invariant, projected two ways,
catches different adversaries: the range projection misses `0`, the set projection catches both `0` and
`±7`. So the choice of falsifier projection is itself a severity decision an author can get wrong by
imagining the wrong adversary — which is the whole argument for `prove:adversarial`. `vote-value-in-set`
records the finding as a permanent, falsifiable claim alongside `vote-value-in-band`.

## Mechanical controls + the out-of-loop monitor

ImpossibleBench measured three cheap mechanical controls cutting cheating 54% → 9%: read-only test
files, the grader outside the writable workspace, and an explicit abort affordance ("flag for a
human"). QARoom cannot make a Git file truly read-only to an agent holding the keys, so the honest,
partial realization is an **out-of-loop monitor** (`agent-controls.yml`) that is NOT in the reward loop:
it does not pass/fail the PR, it flags any diff that edits a test (oracle) file so a human confirms the
assertion was strengthened, not neutered. The abort affordance is social + documented (AGENTS.md: a red
is a real finding — STOP and surface it). True read-only enforcement via a separately-credentialed CI
identity is named and deferred.

## Anchored-severity-coverage (sidecar)

`pnpm anchored:coverage` writes the **anchored ratio** — the fraction of documented gate-bearing
boundaries that have an owning Tier-0 claim — to a SEPARATE evidence file
(`test-results/anchored-coverage.json`; `summary.json`'s schema is FROZEN, so it is never touched). A
boundary with no owning claim has no human-independent anchor; the sidecar REPORTS those (the
"boundary with no owning claim" signal) but is **advisory** — a hard floor would force a fake claim to
go green, the exact Goodhart failure this experiment guards against. A binding ratchet on the diff is
deferred to T24's tiering.

## Deferred (named, out of this slice)

- **Differential coverage / mutation ratchets on the diff** — the Tier-2 "defended by ratchets"
  enforcement. Needs T24's promotion-ledger tiering; named there and in T18-core.
- **Separately-credentialed CI identity + SLSA / sigstore-signed gate evidence** — the cryptographic
  half of "binding + signed". Infrastructure, not in this slice.
- **Train-time / model disposition** — reducing reward-hacking propensity at its root. Out of scope for
  a repo; named so the gate layer is not mistaken for the whole answer.

## Consequences

### Positive
- The derivation chain below the codeowned source is now governed and conformance-checked, closing the
  C3 hole an agent would reach for first.
- `prove --break` is adversarial: its mutants come from the measured taxonomy, not the author's
  imagination, and `vote-value-in-set` proves the projection-choice finding (C6) with real teeth.

### Trade-offs accepted
- Two new deliberate-bug toggles widen the demo surface. Accepted: each is census-pinned to a single
  read site and backs a `prove --break` claim.
- The strongest teeth (signed evidence, CI-identity, ratchets) remain deferred, so several gates stay
  advisory. Accepted and **labelled honestly** — an advisory social gate stated as such beats a binding
  one claimed but not enforced.

## Related decisions
- [ADR-0032] the agentic boundary this ADR hardens (it named T23 as the deferred tamper-evidence layer).
- [ADR-0024] single-source invariants — this governs their derivation chain, not just the source.
- [ADR-0026] gate-guard — strengthened here with gate↔target pairs.
- [ADR-0016] / [ADR-0031] mutation as the assertion-strength defender behind the adversarial taxonomy.
