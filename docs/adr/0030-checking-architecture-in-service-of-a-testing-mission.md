# ADR 0030: A checking + evidence architecture in service of a testing mission (T01/T02)

- **Status:** Proposed
- **Date:** 2026-06-28
- **Records:** the honest name for what QARoom is — **a human-designed checking-and-evidence
  architecture whose mission is testing** — and the philosophy that follows from taking that name
  seriously: a Popperian, falsification-first stance; *severity* (`P(red | behavior broken)`) as the
  unit of quality; and the three pillars the later cards realize (falsification-first checking,
  tamper-evidence under an adversarial writer, and a promotion-ledger CI that survives agent velocity).
  It reframes the front-door thesis (README hero + [ARCHITECTURE.md](../../ARCHITECTURE.md) §1) and adds
  the operating model ([docs/operating-model.md](../operating-model.md)).
- **Does not modify** [ADR-0001](0001-foundational-decisions.md), and — unlike most cards — it **touches
  no invariant source**. It edits no `claims.ts` / `detection-matrix.ts` / `boundary-registry.ts`, adds
  no claim, no schema, no toggle, no runtime behaviour. It is a *naming and framing* decision over the
  docs the other cards already enforce. The drift gates (`links:check`, `stats:render`,
  `claims:verify`) are its only mechanical contract.
- **Relates to:** [ADR-0016](0016-testing-your-tests.md) (severity — testing the tests) and
  [ADR-0031](0031-mutation-testing-the-testing-utils-harness-surface.md) with the companion analysis
  [severity-oracle-independence.md](../severity-oracle-independence.md) (Pillar 1);
  [ADR-0032](0032-agentic-development-as-a-tested-boundary.md) +
  [ADR-0033](0033-check-governance-and-tamper-evidence-under-an-adversarial-writer.md) (Pillar 2, the
  adversarial-writer boundary); [ADR-0026](0026-auto-merge-router-and-why-the-gate-claim-stays-out-of-the-manifest.md)
  (the realized seam of Pillar 3); [ADR-0024](0024-verifiable-invariants-single-source-enforced-at-the-boundary.md)
  (the derive-from-one-source discipline this names as the chain to govern); and
  [ADR-0006](0006-mcp-as-tested-service.md) / [ADR-0020](0020-moderator-rag-and-eval-stack.md) for the
  honest-scope ADR shape it follows.

## Context

For twelve milestones the front door called QARoom a **"testing architecture."** That phrase is a
category error, and the repo's own thesis is the reason it matters. In Bach & Bolton's
checking-vs-testing distinction:

- **Checking** is the *algorithmic verification of a pre-stated proposition* — a machine evaluating an
  assertion the human already decided was worth asserting. A property test, a Pact contract, a drift
  gate, a mutation run, a `prove --break`: every one of QARoom's ~24 techniques is a **check**.
- **Testing** is the *sapient* act around the checks: choosing the invariants and the fault model,
  deciding which boundary deserves which oracle, interpreting a counterexample, judging that a leak
  *matters*. No machine does this. It is irreducibly human.

So "everything in this repo is testing" is false: the repo **automates checking**, and the testing is
the human strategy the checks serve. Calling the automation "testing" invites the precise charge the
honest framing pre-empts — *that no testing occurred, only checking* — and worse, it hides the layer
that actually carries the quality: the human conjectures and the threat model. The survivable framing,
adopted here:

> **A human-designed checking strategy whose mission is to surface the system's break conditions, using
> generative input as the engine. The human owns the conjectures and the threat model; the machine
> explores; the human interprets.**

The consequence is a design obligation: **make the sapient layer first-class and visible**, or the
green suite reads as theater. This ADR is that layer written down.

## Decision

### 1. The name

QARoom is **a checking + evidence architecture in service of a testing mission.** Both halves are
load-bearing. *Checking + evidence:* the automation produces mechanically-verifiable propositions and
the drift-gated artifacts that record their verdicts. *In service of a testing mission:* the checks
exist to serve a human testing strategy — to surface break conditions — and are worthless detached
from it. The front door states the dual claim this name implies:

- **Organizational:** quality is an *organizational property the architecture makes cheap to sustain*
  across people, agents, and time — not a property of any one test run.
- **Technical:** checks made *severe* and *tamper-evident*, so that **green means something even when
  agents write the code.**

### 2. The mission: Popperian falsification, not confirmation

A check earns its keep only as a **refutation attempt**. A green suite is *corroboration* — the
conjecture survived this round's attempts to break it — never *proof* that the system is correct. The
unit of quality is therefore **severity**: `P(red | behavior broken)`, the probability a check goes red
*given* the behavior is actually wrong (Mayo's sense). A check that cannot go red when behavior breaks
has severity zero however green it looks — which is exactly what `prove --break` and mutation testing
measure, and what the detection matrix tabulates as a Mayo-severity grid (see
[severity-oracle-independence.md](../severity-oracle-independence.md)).

Four honesties keep the mission from becoming its own Goodhart target:

1. **Severity is relative to a fault model, not absolute.** It is `P(red | broken)` *under an assumed
   class of breaks*. Chase the number as an end and you optimize the fault model you can already see.
2. **The better axis is oracle independence.** The harder an oracle is to satisfy with broken behavior,
   the higher the achievable severity — a ladder: example-assert < property < metamorphic <
   differential < proof-checked invariant. Knowing each boundary's rung (and choosing a low rung on a
   high-consequence boundary *deliberately*) beats chasing a severity scalar.
3. **Pair falsification with verification-where-decidable.** Falsification is for the open, generative
   surface; where a bug *class* is decidable, prove its absence. Types, a BMC/TLC model, a TLA+ spec, a
   DB `CHECK` derived from one constant — these show the *absence* of a class, which is Dijkstra's
   actual point. QARoom uses both tools and labels which is which.
4. **The oracle problem is outside the frame.** A maximally severe check of the *wrong property* is
   confidently wrong, faster. Checks prove behavior matches the *asserted* property; that the property
   is the *right* one is the human's burden and cannot be automated away.

**Engineering honesty about the philosophy itself.** "Corroboration ≠ confirmation" is unshippable as
a literal release rule — you cannot ship "we falsified nothing today." So Popper is used for *design
discipline* (every check is built as a refutation attempt), while go/no-go rests on an **explicit
inductive warrant**: risk-based stopping — *we attacked the highest-consequence conjectures hardest,
they survived, the residual risk is named and accepted.* The two are different tools and the docs say
so; pretending the inductive step away would be the dishonesty this card exists to avoid.

### 3. The three pillars (each realized by a later card)

1. **Falsification-first checking, severity-measured (T18).** Mutation testing + `prove --break` +
   the oracle-independence ranking, with the detection matrix as the severity table.
   *Realized:* [ADR-0016](0016-testing-your-tests.md) / [ADR-0031](0031-mutation-testing-the-testing-utils-harness-surface.md)
   and [severity-oracle-independence.md](../severity-oracle-independence.md).
2. **Tamper-evidence under an adversarial writer (T23/T05) — the novel spine.** When an agent both
   *writes* the code and *runs* its gates, the agent's output is an untrusted input that targets the
   **gates**, not just the product. This is not hypothetical: ImpossibleBench reports a frontier model
   gaming an impossible task ~76% of the time; METR observed an agent monkey-patching its grader;
   Anthropic documented `sys.exit(0)` to fake a pass and sabotage of the very reward-hack detector
   watching it. The defenses: **govern the derivation chain** (not just the source), **adversarial
   `prove --break`**, **invest in the weak-oracle surface** the agent will probe, make gates **binding
   and signed rather than advisory**, and lean on cheap mechanical controls (which moved one reported
   cheat surface from 54% to 9%) — *defense in depth* across train-time, monitor, and gate, because a
   gate alone is one layer, not a perimeter.
   *Realized:* [ADR-0032](0032-agentic-development-as-a-tested-boundary.md) (the boundary + first three
   claims) and [ADR-0033](0033-check-governance-and-tamper-evidence-under-an-adversarial-writer.md)
   (the buildable governance core).
3. **A promotion-ledger CI that survives agent velocity (T24).** `true_head ≠ green_head`: at agent
   speed the last *green* commit is not the last *trustworthy* one. Tier by **risk**, not by time;
   batch-and-bisect culprit-finding in `O(log n)`; **never reward at presubmit** (reward trust budget,
   not a green tick on an open PR); **no auto-revert on the stateful change class.**
   *Realized seam:* [ADR-0026](0026-auto-merge-router-and-why-the-gate-claim-stays-out-of-the-manifest.md)
   wires the deterministic oracles into a merge decision; the full risk-tiered promotion ledger is the
   named T24 extension on that seam.

### 4. Open problems (named, not papered over)

- **The oracle problem.** Checks prove behavior matches the asserted property, never that the property
  is correct. Irreducibly human; no gate closes it.
- **Gate-only defense is insufficient.** Against a train-time disposition to cheat, the gate is one
  layer of defense-in-depth, not a perimeter. QARoom owns the gate layer well and is explicit that
  train-time and monitoring are outside its reach.
- **The anchored ratio has no formula.** "How much of the green is anchored to a strong oracle vs. a
  weak one an agent could game" is a judgment. It is made *observable* and signal-tripped, not solved.
- **The meta-gate regress terminates only out-of-band.** A gate that guards the gates needs a gate…
  until the chain ends at a **signed, out-of-band** root (branch protection + attestation on a separate
  identity). Until that exists, the top of the chain is a **social** gate, and the docs say so.

### 5. The decided forks

1. **Name** = "a checking + evidence architecture in service of a testing mission."
2. **Gate teeth** — the *target* is **binding** (branch protection + signed/attested CI on a separate
   identity). Until that lands, gates are honestly labelled **advisory**; we do not claim binding where
   only social.
3. **Auto-revert** — **change-classified**; **no auto-revert on the stateful class** (a reverted
   migration or data change can be worse than the bug).
4. **Scope of this card** — the name + this ADR + the operating model + the front-door reframe, with
   the pillars realized in T18/T23/T05/T24's own cards. This card frames; it does not re-implement them.

## Consequences

- **The sapient layer is now first-class and visible** — the front door states what the human owns
  (conjectures, threat model, interpretation) and what the machine owns (exploration), so a green suite
  no longer reads as a claim of correctness.
- **The vocabulary is honest.** "Checking" and "testing" mean different things across the docs; the
  detection matrix is a severity table; corroboration is never written as proof.
- **No mechanical surface changes.** No claim, schema, gate, or runtime behaviour is added; the only
  enforcement is the existing drift gates on the prose this card edits. A reframing that changed an
  invariant source would be a different, Code-Owner-gated decision — deliberately not bundled here.
- **The open problems are load-bearing, not footnotes.** The architecture's ceiling (oracle problem,
  gate-only defense, the un-formulated anchored ratio, the social top-of-chain) is stated where a
  reader meets the thesis, so the strength claimed is the strength owned.

## Rejected alternatives

- **Keep "testing architecture."** Rejected: the category error this whole card is about — it hides the
  human layer and invites the "no testing occurred" charge.
- **Claim the suite proves correctness.** Rejected: confirmationism. A green suite corroborates; the
  oracle problem alone forbids the stronger word.
- **Claim binding gate teeth today.** Rejected: until branch protection + out-of-band attestation
  exist, the top of the chain is social; "advisory" is the honest label (open problem 4).
- **Fold the philosophy into ARCHITECTURE.md as another section.** Rejected: the WHY belongs in an ADR
  (the non-derivable narrative layer, T25); ARCHITECTURE.md carries the derived landscape and links
  here.

## Invariant-source note

This ADR is deliberately **outside** the invariant-guard surface: it edits no covered path
(`packages/contracts/**`, `spec/**`, the claims/detection-matrix manifests, ADR-0001). It introduces no
new "must" prose into the enforced conventions and adds no claim — the AGENTS.md "thin router" rework is
the separate T25 card. Its discipline is purely that every relative link it adds resolves
(`pnpm links:check`) and the stats line stays byte-exact after the ADR-count bump (`pnpm claims:verify`).
