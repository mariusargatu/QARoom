# Spike 7: Stateful PBT + all-transitions coverage over a state-machine-modeled API

- **Milestone affected:** post-12 (extends the Milestone-5 MBT story)
- **Question:** Can one hand-authored XState machine drive BOTH a stateful property-based
  bug-finder (`fc.commands`, first use in the repo) and a provable all-transitions coverage
  claim against the live API — and is that claim something `@xstate/graph` path generation
  and the Schemathesis stateful gate do not already give us?
- **Verdict:** ✅ **PASS** (4/7 → 7/7 edges proven; a seeded transfer-fault demo shrinks to a
  2-step minimal counterexample)

## The gap, measured

`@xstate/graph`'s `getShortestPaths`/`getSimplePaths` guarantee reaching every **state**
(node coverage), not crossing every **transition** (edge coverage). On the rollout machine
(5 states, 7 edges) the three back-to-`Off` edges are structurally invisible to both
generators: a return to a visited state is on no shortest path, and it makes a path
non-simple. Pinned by a guard test (`edge-coverage.test.ts`): shortest paths cross exactly
**4/7** edges; simple paths miss the **same three**:

```
Enabling  --RolloutAborted-->   Off
Canary    --RolloutAborted-->   Off
Disabling --DisableCompleted--> Off
```

A bug on any abort/disable path would hide forever behind a green "all paths replayed" MBT
suite. In Ammann & Offutt's hierarchy this is the step from node coverage to **edge coverage
(all-transitions, the 0-switch criterion)** — the minimum ISTQB CT-MBT considers adequate;
all-states alone is "the weakest". Transition-pair (1-switch) coverage is the named next
rung, deliberately out of scope.

## What was built

One machine (`rolloutMachine`, unchanged), three new pieces:

1. **Edge-coverage bridge** (`packages/testing-utils/src/screenplay/mbt/edge-coverage.ts`,
   reusable for any flat machine): `allEdges` enumerates the declared-transition denominator
   from the machine config; `edgesOfPaths` derives the edges a path set crosses (JSON-parsing
   the quoted step states — skipping that parse silently disjoins the sets); `edgeRecorder` +
   `coverageReport` do the bookkeeping and emit the gap as a deterministic work list.

2. **Stateful PBT driver** (`services/flags/tests/mbt/`): `fc.commands` sequences of rollout
   events against the live in-process flags-service. `check()` never filters on legality —
   fast-check skips commands whose `check()` fails, so filtering would make the 409 path
   unreachable dead code. Instead `run()` derives expected legality from `applyRolloutEvent`
   (the same function the service drives — one legality source, no drift) and asserts the
   dual oracle after **every** command: legal → 200 + echoed target state + idempotent
   replay; illegal → 409 RFC 7807 `rollout-transition-illegal` + state untouched (the
   QuviQ/PropEr negative-testing pattern: the model transition is identity). A separate
   deterministic test pins the sharp edge that a 409 is never stored for its idempotency key.

3. **Deterministic gap-fill + artifact** (`rollout-edge-coverage.spec.ts`): for each gap
   edge, walk the shortest route to its source state checking the echoed state at every step,
   fire the one event, assert the echoed target — then assert path-edges ∪ gap-fill = **7/7
   edges, 5/5 vertices**. The artifact (`test-results/mbt-edge-coverage.json`) is execution
   evidence, folded into `summary.json` by `pnpm mbt:results` as the `mbt-edge-coverage`
   runner.

Pattern provenance: random-walk-then-deterministic-gap-fill is GraphWalker's
`quick_random` + `edge_coverage(100%)` stop condition, decomposed into reset-separated paths.
A Chinese-Postman single tour was considered and rejected: no maintained JS solver, terminal
states break single-tour assumptions, and the gap-fill is equivalent for this size.

## Why the echo makes this a checking sequence

The rollout endpoint echoes its machine state after every transition — a reliable **status
message** in conformance-testing terms. A transition tour whose status is checked after every
step is a **complete checking sequence** (Lee & Yannakakis 1996): it detects **output faults
AND transfer faults**, which bare edge coverage does not. The OTel `xstate.transition`
reverse-conformance spans (ADR-0012) are the independent second witness that the status
message itself does not lie.

## The transfer-fault demo

`FLAGS_BUG_CANARY_MISROUTES=1` (service-side in `services/flags/src/repository.ts`, gated
`NODE_ENV !== 'production'`, pattern of `CONTENT_BUG_FEED_REVERSED`) misroutes a successful
`CanaryConfirmed` to land on `Enabled` instead of `Canary`. Every observable — persisted row,
echoed state, outbox event, transition span — coherently reports the wrong target, so only a
test holding its own model can catch it. Injected service-side on purpose: a bug in the
shared contracts runner would corrupt the test's own legality oracle in lockstep and prove
nothing.

Result with the toggle on:

```
Counterexample: [EnableRequested,CanaryConfirmed /*replayPath="FDI:F"*/]
Shrunk 3 time(s)
AssertionError: service must echo the machine's target after CanaryConfirmed:
  expected 'Enabled' to be 'Canary'
{ seed: 12648430, path: "2:2:1:1", endOnFailure: true }
```

fast-check shrank the failing sequence to the 2-step minimum and named the exact divergence.
**Replay needs three values, not just the seed** — the executed-vs-skipped command history
lives in `replayPath`: re-run with `VITEST_SEED=<seed>`, pass `{ seed, path }` to `fc.assert`
and `{ replayPath }` to `fc.commands`. Remove `replayPath` again after fixing.

## Honest delta vs the Schemathesis stateful gate

Schemathesis (`--phases stateful`, spike 2) already tests **sequences** and already
**follows links** — neither is a delta. What it cannot do, because the oracle is not in the
schema: hold a named state-machine model, assert the echoed state against that model's target
after every step, claim **all-transitions coverage with a number** (`7/7`), or shrink a
failing sequence to a minimal counterexample with seeded replay. None of
RESTler/EvoMaster/Schemathesis asserts all-transitions over an explicit FSM. Keep both:
Schemathesis for per-spec breadth, this for model-conformance depth.

## Costs and constraints

- Phase 1 budget: 15 runs × ≤10 commands, fresh pglite per sequence ≈ 6 s local; per-test
  timeout raised to 120 s so a mid-shrink Vitest kill cannot truncate the minimal
  counterexample (each shrink iteration boots a pglite).
- `commands.ts` lives in `tests/mbt/` and matches neither the test-file lint globs nor the
  production blocks — branching in `run()` is deliberate and lint-legal; the spec bodies stay
  conditional-free via `withFlagsCtx` (harness-owned try/finally, so shrinking never leaks a
  pglite).
- fast-check stays at the repo's ^3.23: v4 made no breaking MBT-API changes; the bump is a
  separate dep-wide concern.

## Consequence

The bridge + command pattern graduates to any flat machine with a state-echoing endpoint
(webhook-delivery and migration are next candidates; the multi-resource model against the
live composed stack is the destination, with model-as-oracle replacing the echo). Proposing
an ADR and a `docs/03-testing-strategy.md` §4 portfolio row is deferred until a second
machine adopts it.
