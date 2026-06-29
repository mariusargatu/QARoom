# ADR 0040: A trigger-scoped CI pipeline — fast PR lane, scheduled nightly, manual release

- **Status:** Proposed
- **Date:** 2026-06-29
- **Records:** the decision to split the single `dispatch-first` `ci.yml` monolith into **trigger-scoped
  workflows** — a thin PR lane, a scheduled nightly regression suite, a manual release pipeline, a
  weekly eval tier, and reusable lane libraries — so that a pull request shows a **handful of real
  checks instead of ~19 grey "Skipped" jobs**, while the deliberate dispatch-first **cost** intent
  (no automatic CI storm on the expensive lanes of a build-in-public repo) is preserved. It also
  records the new **scheduled automatic triggers** (integration nightly, heavy weekly, both
  activity-gated) as a deliberate cost decision, and adds **`actionlint`** as a workflow-lint gate.
- **Supersedes** the dispatch-first *packaging* (not the cost intent) that previously lived as a prose
  rationale in the `ci.yml` header. The cost intent it described is **kept**; only its single-file
  packaging — the actual cause of the skipped-job noise — is replaced.
- **Does not modify** [ADR-0001](0001-foundational-decisions.md). It is a CI-shape change, an
  implementation choice the foundational decisions leave open. The frozen `test-results/summary.json`
  schema ([test-results-schema.ts](../../packages/contracts/src/test-results-schema.ts), Commitment
  14 / [ADR-0024](0024-verifiable-invariants-single-source-enforced-at-the-boundary.md)) is **untouched**: the
  `summary-envelope` fan-in job moves into a reusable workflow (`_envelope.yml`) byte-for-byte; only
  its host file changes, not the schema or the census semantics.
- **Relates to:** [ADR-0026](0026-auto-merge-router-and-why-the-gate-claim-stays-out-of-the-manifest.md)
  (the auto-merge router + reviewer-agents — the other PR-time checks, untouched here),
  [ADR-0017](0017-testing-ai-integrated-systems.md) / [ADR-0020](0020-moderator-rag-and-eval-stack.md)
  (the eval tier this gives its own file), and [ADR-0030](0030-checking-architecture-in-service-of-a-testing-mission.md)
  (the checking + evidence mission the evidence envelope serves).

## Context

CI was **dispatch-first**: one `ci.yml` held **20 jobs**, of which `verify` ran on a pull request and
the other **19** were gated `if: github.event_name == 'workflow_dispatch' && inputs.tier == …`. The
cost reasoning was sound — a build-in-public repo on a fresh remote gains nothing from auto-running
KinD/k6/Stryker/Chaos on every PR — but the **packaging** had a corrosive side effect:

> Because the 19 heavy jobs lived in the *same file that a pull request triggers*, GitHub listed every
> one of them on every PR as a grey **"Skipped"** check.

A reviewer (or a hiring manager skimming the repo) opened a PR and saw ~3 real checks drowned in ~19
"Skipped" lines. That reads as a broken or confused pipeline, not a deliberate one. The signal-to-noise
was wrong, and the fix is not cosmetic re-gating — a false-`if:` **job** still renders as "Skipped".

The load-bearing GitHub mechanic is at the **workflow** level, not the job level:

> A workflow that is **not triggered** for an event produces **zero** checks for that event. Only jobs
> *inside a triggered workflow* whose `if:` is false render as grey "Skipped".

So the cure is to move every lane a PR should not show **out of the PR-triggered file** into workflows
a PR never triggers. That also happens to be the shape a mature engineering org already uses: a fast
required PR check, a scheduled regression suite, and a manually-cut release pipeline.

## Decision

Split `ci.yml` by **trigger and intent**. The resulting layout:

### Runs on a pull request (all a reviewer sees)

| Workflow | Trigger | Job(s) | Notes |
|---|---|---|---|
| `ci.yml` | `pull_request` + `workflow_dispatch` | `verify` | The fast in-process lane. **Required** status check — kept an inline top-level job named exactly `verify` (a `workflow_call` job would rename the context to `ci / verify` and break branch protection). No `paths-ignore` (a path-filtered required check deadlocks merge). Adds an `actionlint` step + `concurrency` cancel-in-progress. |
| `reviewer-agents.yml` | `pull_request` | `review` | **Required** — unchanged (ADR-0026). |
| `auto-merge-router.yml` | `pull_request` | `route` | Advisory labeler — unchanged. |
| `invariant-guard` / `gate-guard` / `promotion-ledger-guard` / `agent-controls` | `pull_request` **(paths)** | `flag` | Advisory, **path-filtered** — kept as separate files. Each emits **zero** checks unless the PR touches its paths (a non-triggered workflow shows nothing). Deliberately **not** merged into one `if:`-gated job, which would re-introduce "Skipped" noise *and* strip the promotion-ledger hard-red of its teeth. |

> A typical PR now shows **`verify` + `review` + `route`** — three real checks, zero "Skipped". A PR
> that touches contracts / gates / tests surfaces the relevant advisory check(s) too, which reads as
> intentional context, not noise.

### Never runs on a pull request (zero PR checks each)

| Workflow | Trigger | Purpose |
|---|---|---|
| `nightly.yml` | `schedule` + dispatch | **Integration tier nightly, heavy tier weekly** — both **activity-gated**. Calls the reusable lanes + the terminal envelope **in one run**. |
| `release.yml` | `workflow_dispatch` | Manual promotion pipeline: **build → integration → promote** (staged like a real release; honest dry-run — QARoom publishes no images). |
| `evals.yml` | weekly `schedule` + dispatch | The cost-bounded real-OpenAI eval tier, on its own cron so it fires alone. |
| `security.yml` / `frontend-perf.yml` | dispatch + `workflow_call` | Supply-chain/appsec scans and frontend perf — now foldable into the nightly run. |
| `pages.yml` | push `main` (paths) | Static site deploy — unchanged. |
| `_integration.yml` / `_heavy.yml` / `_envelope.yml` | `workflow_call` only | Reusable lane libraries: the tiered lanes defined **once**, called by nightly / release. |

### Cadence (the cost decision)

The one genuinely new automatic cost is the **scheduled** runs. To keep the dispatch-first intent
("don't burn minutes on idle days"):

- **Integration nightly, heavy weekly.** The cheaper integration tier (contracts, fuzz, cluster-smoke,
  tracetest, web CT, coverage) runs nightly; the expensive heavy tier (k6 vs SLOs, Stryker mutation,
  EvoMaster, Chaos Mesh) + the static security scans run **weekly**.
- **Activity-gated.** A scheduled run with **no new commits** in its window (24h for integration, 7d
  for heavy) short-circuits before spending any lane minutes — GitHub's standard scheduled-workflow
  pattern.
- **Everything stays on-demand.** Every tier is still runnable from the Actions tab; `release.yml`
  runs the full suite for a deliberate promotion.

### Compression / tooling

- **Reusable workflows** (`workflow_call`) for the tier libraries — the lane definitions live once,
  not duplicated per trigger.
- A **`serve-and-wait` composite action** collapses the start-service + poll-`/system/state` block
  that was copy-pasted across the fuzz / load / evomaster / frontend-perf lanes.
- **Matrices** collapse the 5 sequential `pact:verify` steps and the near-identical single-service
  Schemathesis lanes (the two-service gateway fuzz stays its own job — its topology differs).
- **`actionlint`** (pinned) lints every workflow's YAML, expression graph, and — via the runner's
  shellcheck — the `run:` blocks (`SHELLCHECK_OPTS=--severity=warning`: bugs, not style), in the
  required `verify` lane. With the pipeline now spread across more files, a malformed `if:`/`needs:`
  that would deadlock a required check is caught on the PR, not minutes into a dispatched lane.

## Consequences

- **The skipped-job eyesore is gone.** A PR shows real checks only.
- **Branch protection is unchanged.** `verify` and `review` keep their names; no required-context edit.
- **Latency trade-off (accepted):** a contracts / moderator / cluster regression is now caught at the
  nightly run (or a pre-merge `release` dispatch), not on the first PR commit. The PR lane buys speed
  by deferring the lanes that need uv / KinD / a key. A maintainer who wants the full check before
  merging dispatches `release.yml`.
- **One envelope per run.** Because nightly / release / evals each call their lanes **and** the
  terminal `_envelope` job in the **same run**, artifacts are shared and the frozen-schema envelope
  assembles exactly as before (absent cluster/keyed runners resolve `DEFERRED`, not fatal — the
  schema already supports this). The PR run intentionally does not assemble a full envelope; its
  `verify` job still uploads `partial-verify` for reviewer-agents.
- **Merge queue is deliberately deferred.** Enabling `merge_group` would require *every* required
  check (both `verify` and `review`) to also trigger on it, atomically, or the queue deadlocks — out
  of scope here; a clean later opt-in.

## Alternatives rejected

- **Re-gate jobs to hide them on PRs (keep one file).** A false-`if:` job still renders "Skipped" —
  this is the status quo and does not fix the UX.
- **`paths-ignore` on the PR lane.** A path-filtered *required* check never reports on an excluded PR
  and deadlocks merge — a documented prior lesson.
- **Merge the four advisory guards into one always-on `if:`-gated job.** Re-introduces "Skipped"
  noise, and a path-filtered required version would deadlock; the promotion-ledger hard-red would lose
  its branch-protection teeth.
- **Persist Turbo's test cache across CI runs as the wall-clock lever.** The repo has a documented
  cold-vs-warm false-green (PGlite property suites starve cold); a cross-run test cache would entrench
  the warm-green the gates exist to catch. Cache build/typecheck only, never test execution.
