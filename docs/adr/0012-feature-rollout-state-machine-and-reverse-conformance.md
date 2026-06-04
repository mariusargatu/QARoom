# ADR 0012 — Feature-flag rollout as an XState machine, MBT, and reverse conformance

- **Status:** Accepted
- **Date:** 2026-06-04
- **Records:** the Milestone 5 core demonstration — modelling the donations rollout as an XState
  machine, generating model-based tests (MBT) from it, and verifying the running system never
  leaves the model via OpenTelemetry `xstate.transition` spans + Tracetest. Builds on the
  Milestone-2 migration machine (the first invoke-free/context-free XState taste). Does **not**
  modify any ADR-0001 commitment.

## Context

A feature flag in QARoom is not a boolean — it is the current state of a *gradual rollout*
(`Off → Enabling → Canary → Enabled`, with a reverse `Enabled → Disabling → Off`). Rollouts are
where state-transition bugs hide: an illegal transition accepted, a state reachable that
shouldn't be, a UI offering an action the server will reject. These are exactly the bugs a
hand-written example test rarely covers and a *model* does.

## Decision

**1. The rollout is one hand-authored XState 5 machine** (`packages/contracts/machines/
rollout.machine.ts`), and it is the single authority on transition legality. The flags-service
applies a client-requested event through `applyRolloutEvent` (the runner); an event with no
transition from the current state leaves the state untouched → the route returns 409, never a
silent no-op. The machine, the `FlagState` contract, and the `RolloutEventName` contract are
pinned equal by a test, so the API can never report an unreachable state.

**2. The machine is invoke-free and context-free**, exactly like the migration machine — the
load-bearing constraint for `@xstate/graph` 3 (it hard-rejects `invoke`/`after`, and `context`
explodes the BFS). Async/timer boundaries are modelled as explicit events. A regression test
(`rollout-traversal.regression.test.ts`) pins both halves: the rollout model traverses, and an
`invoke`-bearing machine throws.

**3. MBT generates Screenplay flows from the model.** `shortestPaths(machine)` (PR CI) /
`simplePaths` (nightly) with `allowDuplicatePaths: true` + a value-only `serializeState`
(ADR-0005). The flags-service conformance test (`rollout.mbt.spec.ts`) replays every shortest
path against the live service and asserts the reported state matches the model at every step; a
broken transition fails exactly the paths that cross it and names the divergent state. A model-
validation guard runs first (system initial state + event surface must match the model), and a
path-count **floor** catches a regression that erases reachable states.

**4. Reverse conformance via spans.** Every committed transition emits an `xstate.transition`
OTel span carrying `{machine, from, to, event}` — emitted by the flags-service repository
*after* the transaction commits (so an observed span always reflects committed state). These
spans are **always-sampled** (`XStateTransitionSampler`, `@qaroom/otel`) so a head-sampling
decision can never drop one. A Tracetest assertion checks each observed `(from, to, event)` is a
legal edge of the model graph: if the code ever emits an off-model transition, the spans — not
the endpoint — catch it.

## Consequences

### Positive

- One model is the source of truth for: transition legality (server), the events the UI offers
  (`useRollout` reads the same machine), the generated tests, and the reverse-conformance
  assertion. They cannot drift independently.
- The two exit-criterion demos are mechanical: break a transition → one MBT path fails at the
  exact state; emit an off-model `to` → the Tracetest `xstate.to` assertion fails.

### Negative / trade-offs accepted

- The context-free constraint pushes per-rollout data (cohort, requester) out of the machine and
  into service rows — intentional, to keep `@xstate/graph` traversal finite.
- `@xstate/graph@3.0.4` is pinned **exact**; the invoke-rejection and traversal options are
  undocumented internals a minor bump could change.
- Reverse conformance needs always-sampled transition spans; tail-based sampling can be layered
  on later without changing the assertion.

## Rejected alternatives

- **A boolean flag.** Loses the rollout story entirely and hides the transition bugs this
  milestone exists to catch.
- **Driving async work with `invoke`/`after` in the model.** `@xstate/graph` rejects it; the
  runner-drives-the-machine pattern (migration precedent) keeps the model traversable.
- **Trusting `/system/state` for conformance.** A stale actor could report a state the spans
  contradict; the spans are the truth (the endpoint can be buggy).

## Related decisions

- [ADR-0005](0005-frontend-testing-stack.md) (MBT generation options, Screenplay seam),
  [ADR-0010](0010-sync-vs-async-and-otel-propagation-contract.md) (OTel propagation),
  `docs/04-roadmap.md` Milestone 5, the Milestone-2 migration machine.
