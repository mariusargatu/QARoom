# The gauntlet

One orchestrated run of every testing technique in the repo against one live system, evidence
folded into the one frozen `test-results/summary.json` envelope, composition observed
deliberately. The complement of per-PR CI: CI optimizes for fast isolated feedback; the gauntlet
answers *"what actually happens when everything runs together at the max?"*

Running it for real paid off. [Seam A](#seam-a-chaos-state-replay-the-finale), replaying a large chaos
bundle, uncovered **three restore defects in sequence, each hidden behind the previous** (a 1MB body
limit, a swallowed error, and the real cause: `MAX_PARAMETERS_EXCEEDED`). That cascade is the case for
running everything together, not just in isolation.

```bash
pnpm gauntlet                  # all phases (≈2.5–3.5 h, ~70% walk-away)
pnpm gauntlet --only 1         # one phase
pnpm gauntlet --from 3         # resume an interrupted run at a phase boundary
pnpm gauntlet --pyrit          # include the PyRIT multi-turn red-team (longest, most spend)
pnpm gauntlet --triangulate    # arm one live toggle vs live techniques in phase 8
pnpm gauntlet --reuse-cluster  # skip k3d bootstrap (keeps existing cluster + its state)
pnpm gauntlet --down           # tear the cluster down at the end (default: stays up)
pnpm gauntlet:report           # re-render test-results/gauntlet/report.md from the journal
```

## Failure semantics

Three step classes (`scripts/lib/gauntlet-plan.ts` is the plan-as-data):

- **infra**: red aborts the run; nothing downstream is meaningful (cluster boot, Tilt).
- **gate**: red is a *finding*; recorded, the run continues, the final exit code is non-zero.
- **observe**: cannot be red, only data. An observation that gated would be theater; a gate
  that merely observed would be false-green (`prove.ts`'s honesty discipline, applied here).

Anything unavailable demotes to an honest **skip with a recorded reason**: no `OPENAI_API_KEY`
-> LLM lane skips; no Java 17 -> EvoMaster skips; no `tracetest` CLI -> trace assertions skip;
no k3d/tilt -> every cluster phase skips (phases 1–2 still run).

## Execution graph

| phase | what | why this order |
|---|---|---|
| 0 | preflight (tool/key detection) | skips decided up front, recorded in `steps.jsonl` |
| 1 | fast lane: vitest aggregate -> folds (mbt, pact, moderator, web-component, coverage) -> drift gates | `test-results:generate` REWRITES the envelope: it must run before every fold |
| 2 | Stryker ∥ LLM evals (concurrent lanes) | CPU-bound vs network-bound; neither measures wall-clock: the only sanctioned concurrency outside phase 7 |
| 3 | cluster up: k3d -> `tilt ci` -> Chaos Mesh -> smokes | fresh cluster default (also guarantees the TimeChaos sysctls from `bootstrap-k3d.sh`) |
| 4 | pristine baseline: seed -> **`replay:capture gauntlet-baseline`** -> MBT tour/race probe -> all 5 Tracetest defs -> tenant-span audit | the baseline bundle and clean trace/span data must exist **before any pollution** |
| 5 | k6 clean: thresholds drift gate -> vote-cast + feed (gates) -> donation (observe, expected-fail) | load measured before fuzz bloats the tables; host must stay quiet |
| 6 | fuzzing: Schemathesis ×3 against the gateway **with live upstreams** -> EvoMaster -> tenant-span re-audit | composition #1: do fuzzer-shaped requests still carry `tenant.id`? |
| 7 | chaos: `chaos:run` (01–05, 07) -> **k6-under-chaos** (02×vote-cast, 04×donation) -> **Tracetest-under-chaos** | compositions #2–#3: SLO degradation magnitude; trace-assertion robustness under latency |
| 8 | aftermath: capture `gauntlet-aftermath` -> replay regression -> Tracetest recovery -> tenant-span final (`--fold`) -> optional triangulation -> `claims:verify` | composition #4: quantified state pollution (baseline vs aftermath bundle diff); claims proven against THIS run's evidence |
| 9 | report + meta-runner fold (+ optional teardown) | derived-only render from `steps.jsonl` + `summary.json` |

## Composition observations (the point of the exercise)

1. **Tenant spans under fuzz traffic**: every technique's cluster traffic becomes tenancy-audit
   data for free (`check:tenant-spans` before/after Schemathesis + EvoMaster).
2. **SLO degradation under chaos**: `scripts/k6-under-chaos.sh` runs k6 mid-fault,
   measure-only by default (`K6_SLO_MULTIPLIER=100`); the payload is the delta vs phase 5, not
   a pass/fail. With `CHAOS_SYNC_PUBLISH=1` armed it becomes a gate: the composition-only bug
   (failure-modes.md#02) is red ONLY under chaos+toggle+load.
3. **Trace assertions under chaos**: two Tracetest defs while NetworkChaos delay is active.
   Robust or flaky?
4. **State pollution + replayability survival**: baseline vs aftermath snapshot bundles;
   `replay:regression` after the whole battery ran.
5. **Live triangulation** (`--triangulate`): `scripts/live-toggle.sh` arms
   `CONTENT_BUG_FEED_REVERSED` on the deployed content-service and runs the feed-touching live
   techniques: `prove --break` at gauntlet scale.

## Known issues routed around (not hidden)

- **donation k6 is observe-class expected-fail**: the Microcks payment mock 404s
  `POST /charges` -> in-cluster donations 502 (known issue, 2026-06-08; fix is separate work).
  Artifact kept at `test-results/known-issue-k6-donation.json`, outside the k6 fold glob.
- **Chaos 06/08 (Litmus HTTPChaos)**: pending ChaosCenter setup (ADR-0014); honest skips.
- **macOS networking**: k6/Schemathesis containers reach port-forwards via
  `host.docker.internal`, never `--network host` (Linux-CI-only trick).

## Artifacts

- `test-results/summary.json`: the single numeric source of truth; the gauntlet ADDS runners
  (`pact`, `schemathesis`, `tracetest`, `coverage`, `tenant-spans`,
  `gauntlet`) through the frozen envelope's extensible per-runner payload. Zero schema changes.
- `test-results/gauntlet/steps.jsonl`: append-only run journal (timing, exits, skip reasons);
  what makes `--from <phase>` resumability and the report possible.
- `test-results/gauntlet/report.md`: rendered, derived-only.
- `test-results/gauntlet/logs/<phase>-<step>.log`: full per-step output.

Related: the **detection matrix** (`docs/detection-matrix.md`, `pnpm matrix`) is the
bug-side complement: gauntlet runs every technique once; the matrix arms every deliberate bug
and measures which techniques notice.

## Seam A: chaos-state replay (the finale)

`scripts/replay-under-chaos.sh <scenario> [tracetest-def...]` closes the loop Commitment 6
promised but never wired: capture a scenario WHILE a chaos experiment is active
(`replay:capture <s> --chaos <slug>` embeds the experiment YAML in the bundle), then replay it
into the live cluster with that exact fault reapplied (`replay:load <s> --chaos`) and assert
trace shape under those conditions: "a bug that exists only under chaos+state is now a
regression test."

Replaying a gauntlet-sized bundle (a content-service that ran the whole battery captured a 6MB
snapshot) found three restore defects in sequence, each hidden behind the previous: a 1MB body
limit (413), a swallowed error (opaque 500 -> now a 422 Problem with the real cause), and the
real cause, `MAX_PARAMETERS_EXCEEDED`, a multi-row INSERT past Postgres's 65534 bind-param cap.
Restore was only ever exercised on tiny fixtures, so the bulk ceiling stayed invisible until a
real-sized bundle. All three are fixed and guarded by scenario 6 in the M7 regression catalog
(`pnpm replay:regression`, real Postgres), which fails red on the unchunked code.
