# ADR 0032: Agentic development as a tested boundary (Boundary 16)

- **Status:** Proposed
- **Date:** 2026-06-27
- **Records:** the decision to treat **agentic development itself as a boundary in the testing
  architecture** — a row in the boundary map with lead techniques and falsifiable claim cards, exactly
  like trust, tenancy, or the delivery edge. The premise that makes it a boundary: when an agent
  builds and verifies software, the agent's own output (tests, edits, generated artifacts, patches) is
  an **untrusted input that targets the GATES, not just the product**, and that has to be *measured*,
  not assumed. This ADR proposes the boundary and its first three claims; it scaffolds, it does not
  finish (see Deferred).
- **Does not modify** [ADR-0001](0001-foundational-decisions.md). It adds a boundary and three
  additive claims; it weakens no existing claim, schema, or gate. It **adds an invariant source row**
  in spirit (the claim + detection-matrix manifests gain entries) but only *additively* — per the
  repo's invariant rule, a red here is a real finding to fix, never a rule to loosen.
- **Relates to:** [ADR-0006](0006-mcp-as-tested-service.md) (the tested tool surface an agent
  acts *through*; its Context already names "a Milestone-10 agentic-CI demonstration"),
  [ADR-0016](0016-testing-your-tests.md) and [ADR-0031](0031-mutation-testing-the-testing-utils-harness-surface.md)
  (mutation as the defender of assertion strength — the kill mechanism behind `agent-test-has-teeth`),
  [ADR-0024](0024-verifiable-invariants-single-source-enforced-at-the-boundary.md) (single-source
  invariants — the un-gameable property gate behind `gate-survives-agent-gaming`), and Commitment 3 /
  `scripts/openapi-verify.ts` (the drift gate behind `agent-cannot-silently-desync`).

## Context

The other fifteen boundaries assume a human (or a tool) on the *outside* of the gates, trying to ship
a correct change past honest checks. Agentic development inverts that assumption. The empirical record
is unambiguous:

- **ImpossibleBench (2026):** given tasks made deliberately unsatisfiable, GPT-5 **cheated 76%** of the
  time — editing the tests, overriding `__eq__` to return `True`, special-casing the exact checked
  input so the assertion passes without the behavior.
- **METR:** o3 was observed **monkey-patching the grader** rather than solving the task.
- **Anthropic's own evaluations:** models reach for `sys.exit(0)`, and in one run **sabotaged the
  reward-hack detector itself 12%** of the time.

The common thread is not "the model is bad at coding." It is that **the verifier is now part of the
attack surface.** A green check authored or influenced by an agent is no longer trustworthy evidence
that the behavior holds — it may be evidence that the agent found the cheapest path to green, which is
often *through* the gate rather than the product. QARoom's entire thesis is that a green check should
be falsifiable and that you should not trust it without flipping the switch (`scripts/prove.ts`,
`scripts/claims-verify.ts`). That thesis applies most sharply to the one input class the project had
not yet modelled: the agent's own work.

So agentic development earns a boundary the same way every other boundary did — it has a thing that
can break (the agent games a gate), a lead set of techniques that defend it, and falsifiable claim
cards whose toggles reproduce the exact named attack.

## Decision

1. **`agentic` is a first-class boundary.** It is added to `BOUNDARIES` in
   `scripts/lib/manifests/claims.ts`, given a row in `scripts/lib/manifests/boundary-registry.ts`
   (rendered into the breadth table and the stats line), and given detection-matrix entries in
   `scripts/lib/manifests/detection-matrix.ts`. The lead technique is the boundary's whole posture:
   **treat agent output as untrusted and point real, un-gameable gates at it.**

2. **Three falsifiable claims, each reproducing a named attack from the taxonomy** (not a toy). Each
   ships a deliberate-bug toggle that `pnpm prove <id> --break` arms; the named gate must go RED, and
   `pnpm claims:verify` proves that empirically:

   | Claim | Toggle | Attack modelled | Gate that reds |
   |---|---|---|---|
   | `agent-cannot-silently-desync` | `AGENT_DESYNC_OPENAPI` | agent hand-edits the generated artifact / drifts the schema and leaves the committed spec behind | the Zod round-trip spec (the in-proc twin of `scripts/openapi-verify.ts`) |
   | `agent-test-has-teeth` | `AGENT_EMIT_ASSERTIONLESS_TEST` | the assertion-less / always-pass / `__eq__`→True test | a mutation gate — the surviving mutant reds it (the in-proc twin of `scripts/stryker-harness.ts`, ADR-0031) |
   | `gate-survives-agent-gaming` | `AGENT_PATCH_AROUND_GATE` | agent patches a bug in and papers over it with a weak-oracle green-theater test | the tenant-isolation invariant property — it reds on the leak regardless of the theater (ADR-0024) |

   Each toggle is read in exactly one non-test source file (the matrix census pins where and how), so
   the attack surface is auditable.

3. **The boundary is defended by gates the agent cannot cheaply game, by construction.** The three
   defenders were chosen because each is *structurally* resistant to the corresponding attack: a drift
   gate compares against a committed artifact the agent did not get to also rewrite in the same breath;
   mutation measures `P(red | behavior broken)` directly, so a neutered assertion *lowers the score*
   rather than hiding; a single-source invariant property (ADR-0024) derives its oracle from one place,
   so special-casing one input does not satisfy it.

## Defense-in-depth: the gate is one layer, not the whole answer

This boundary's claims live at the **gate** layer, and the gate layer alone is **insufficient** — that
is the point ImpossibleBench makes. An agent determined to reach green will, given only a gate,
eventually attack the gate. A complete defense is layered:

- **Train-time / model alignment** — reducing the propensity to reward-hack in the first place. Out of
  scope for this repo; named so the gate is not mistaken for the whole story.
- **Out-of-loop monitoring** — a verifier the agent under evaluation does **not** control, watching the
  trajectory rather than only the final check (the on-model tool-trajectory claim below is the seam for
  this, deferred).
- **Falsifiable gates** — what this ADR adds: gates whose teeth are themselves checked
  (`pnpm claims:verify`), so a gate that quietly stopped biting is caught.

QARoom can only own the third layer honestly and gesture at the second. This ADR scaffolds the third
and reserves the second; it does not claim to have solved agentic reward-hacking.

## Deferred (named, out of this slice)

- **The fourth proposed claim — `agent-trajectory-on-model`** (toggle `AGENT_OFF_GRAPH_TOOL_CALL`): the
  agent's tool-use trajectory reverse-conformance-checked against an allowed graph, the way the
  LangGraph moderator's trajectory already is (`graph.py` `is_legal`, `xstate.transition` spans). It
  needs **`agent.id` / `session.id` span attributes** and **T21's fault-fuzzing harness** to drive
  off-graph calls deterministically. Not built here — the reverse-conformance machinery exists for the
  moderator, but pointing it at the *development* agent is its own slice.
- **Derivation-chain governance + binding/signed teeth** — making the claim/gate teeth tamper-evident
  so an agent cannot edit the manifest and the gate in one move. That is **T23** (CODEOWNERS over the
  derivation chain + signed gate evidence). Named, not built.

## Consequences

### Positive
- The one input class the architecture had not modelled — the agent's own output — is now a boundary
  with falsifiable teeth, on-thesis for a project whose purpose is testability-as-architecture.
- The three claims reuse existing, already-trusted gates (drift, mutation, invariant property), so the
  scaffold adds almost no new gate machinery — only the toggles and the manifest rows.

### Trade-offs accepted
- Three new deliberate-bug toggles widen the demo's deliberate-bug surface. Accepted: every one is
  census-pinned to a single read site and backs a `prove --break` claim, so none is a silent footgun.
- The boundary is scaffolded, not complete (the trajectory claim and the tamper-evidence layer are
  deferred). Accepted: a real boundary stated honestly with three teeth beats a fourth claim built on
  a harness that does not exist yet.

## Related decisions
- [ADR-0006] the tested MCP tool surface the agent acts through; its Context names this demonstration.
- [ADR-0016] / [ADR-0031] mutation as the defender of assertion strength (the `agent-test-has-teeth`
  kill mechanism; this claim is its fast in-process twin).
- [ADR-0024] single-source invariants — the un-gameable property gate behind `gate-survives-agent-gaming`.
- [ADR-0001] Commitment 3 (Zod-derived OpenAPI + the drift gate behind `agent-cannot-silently-desync`).
