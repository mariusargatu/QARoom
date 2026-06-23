# ADR 0026: An auto-merge router for agent-authored PRs — and why its gate-self-weakening guard is NOT a falsifiable claim

- **Status:** Accepted
- **Date:** 2026-06-23
- **Relates to:** ADR-0024 (verifiable invariants — the invariant-source governance this respects),
  ADR-0023 (the falsifiable-claims/evidence layer this declines to extend). Does **not** modify any
  ADR-0001 commitment. Adds no service, no schema, no runtime behaviour — it is CI/process tooling.

## Context

QARoom is built to be developed by coding agents. With ~10 developers each driving agents, PRs are
opened faster than a human can review them. If every PR waits on a human, the review queue becomes the
bottleneck and the velocity is lost at the door.

The repo already has what a generic team lacks for safe automation: deterministic oracles
(falsifiable claims, drift gates), a Code Owner list for invariant sources, and `invariant-guard`.
This ADR's router wires those oracles into a merge decision.

## Decision

A **router** classifies every PR (pure function `scripts/pr-classify.ts`, unit-tested) into one of
three lanes from what it touches:

- **Lane A — auto-merge (no human):** no invariant path, no gate edit, single boundary, within the
  400-line cap, all required checks green. GitHub auto-merge lands it after the merge queue.
- **Lane B — pre-digested human:** cross-boundary, over cap, or an enforcement (gate) edit. A human
  reads the agent-produced summary, not the raw diff.
- **Lane C — Code Owner:** touches an invariant source. CODEOWNERS already forces this.

Three supporting pieces ship with it: `auto-merge-router.yml` (label + comment + arm auto-merge,
rollout-gated off by default), `gate-guard.yml` (advisory flag for gate-self-weakening), and
`reviewer-agents.yml` + `scripts/reviewer-agent.ts` (one LLM judge per boundary, blocking Lane A on
P2+, cost stamped observe-only into `test-results/reviewer-cost.json`).

The classifier parses the invariant paths **from CODEOWNERS** rather than re-listing them — one
source, same discipline as `invariant-guard`.

## The sub-decision: the gate-self-weakening guard stays OUT of the falsifiable-claim manifest

The single highest-value protection at 10× agent volume is against **gate self-weakening**: an agent
editing a gate (lint rule, gate script, CI workflow) in the same diff as the code that gate checks, to
turn a red check green. It was tempting to encode this as a falsifiable claim in
`scripts/lib/manifests/claims.ts` so it would carry `pnpm prove --break` teeth.

It does not belong there, and this is verified, not asserted. A claim in that manifest must, per
`claims-verify.ts`, satisfy a **WIRED** check: the claim's `toggle` env var must be found by
`grep -rIlE` in **non-test `services/` or `packages/` source** — a real service must read it. The
router is CI/process infrastructure under `scripts/` and `.github/`; no service reads a router toggle.
Adding the claim would therefore make `claims:verify` report *"toggle not found in non-test source" →
RED*. The only ways to make it pass would be to **fake a service read** (theater) or to **broaden the
WIRED grep to include `scripts/`** (weakening a gate to make a check go green) — both are exactly the
failure mode ADR-0024 and AGENTS.md forbid.

The manifest is for **runtime guarantees of the system** (webhook signing, tenant isolation, the vote
±1 band). The router is not a system boundary, so it is not a claim.

The gate-self-weakening guarantee instead has three real, non-manifest teeth:

1. the classifier routes such a PR to **Lane B** — and that routing is unit-tested
   (`scripts/pr-classify.test.ts`: "edits a lint rule AND code in one diff → Lane B");
2. `gate-guard.yml` flags it on the PR;
3. branch protection requires a human on Lane B.

## Consequences

- The router and its guards are **advisory until the repo owner enables branch protection** (required
  checks `verify` / `gate-guard` / `reviewer-agents`, Code Owner review, merge queue) and flips
  `AUTO_MERGE_ENABLED=true`. This is the deliberate ratchet: watch the labels first, then enable
  auto-merge for one boundary (`services/content`) at a time.
- `claims.ts` is **not edited by this ADR.** It is an invariant source; this decision is precisely
  *not* to touch it. Any future attempt to add a router claim must first solve the WIRED-check
  mismatch honestly (e.g. by making the router a real, toggle-reading service) — not by loosening the
  check.
- The reviewer-agent cost ledger is **observe-only**. The per-PR token ceiling is set from the
  measured p95 in a later change (the cost-ledger observe-then-cap phase), not guessed now.
