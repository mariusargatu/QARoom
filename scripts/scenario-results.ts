import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { foldRunner } from './lib/fold-runner'

/**
 * Run each service's deterministic fault-scenario catalog (UNIT-L1-PLAN.md §7) and fold a
 * `scenario:<svc>` lane into the frozen test-results/summary.json envelope — mirrors the per-service
 * `coverage:<svc>` fold (scripts/coverage-results.ts). The faults PGlite cannot produce (down broker,
 * failing DB) surface as typed RFC 7807 + outbox retention; this gives that lane its own named line.
 *
 * IMPORTANT — these specs ALSO run inside each service's normal `pnpm test` and are already counted
 * in the per-package vitest runner. So this fold contributes a single lane-level PASS/FAIL marker to
 * `summary.totals` (not the per-test counts), exactly like coverage-results.ts folds `passed: 1` —
 * folding the real counts here would double-count the headline totals README/claims derive from. The
 * real per-test counts ride in the lane's extensible `output`. The schema is do-not-touch.
 *
 * Must run AFTER `pnpm test-results:generate` (which rewrites the envelope from scratch). Run via:
 *   pnpm scenario:results
 */
interface ScenarioLane {
  /** Literal runner name (NOT a template) so test-results-verify's deriveFoldedRunnerNames sees it. */
  name: string
  svc: string
  filter: string
  /** Renamed from `spec` so the deriver's `(?!\s*spec:)` lookahead can never drop this lane. */
  specPath: string
}

const ROOT = process.cwd()
const summaryPath = resolve(ROOT, 'test-results/summary.json')

const LANES: ScenarioLane[] = [
  {
    name: 'scenario:content',
    svc: 'content',
    filter: '@qaroom/content',
    specPath: 'tests/scenario.spec.ts',
  },
  {
    name: 'scenario:flags',
    svc: 'flags',
    filter: '@qaroom/flags',
    specPath: 'tests/scenario.spec.ts',
  },
]

interface VitestJson {
  numPassedTests?: number
  numFailedTests?: number
  numPendingTests?: number
  numTodoTests?: number
  success?: boolean
}

let anyFailed = false
let folded = 0

for (const lane of LANES) {
  const reportPath = resolve(ROOT, `test-results/scenario-${lane.svc}.json`)
  // Delete any STALE report first: if vitest crashes before the json reporter runs (a compile error,
  // worker death, setup throw), `existsSync` would otherwise see a PRIOR run's passing report and
  // fold last run's counts as the current result — the envelope would silently lie.
  rmSync(reportPath, { force: true })

  try {
    execFileSync(
      'pnpm',
      [
        '--filter',
        lane.filter,
        'exec',
        'vitest',
        'run',
        lane.specPath,
        '--reporter=json',
        `--outputFile=${reportPath}`,
      ],
      { cwd: ROOT, stdio: 'inherit' },
    )
  } catch {
    // A failing scenario exits vitest non-zero, but the JSON report is still written for assertion
    // failures — fold it (so the failure is recorded, not swallowed) and flag a non-zero exit below.
    anyFailed = true
  }

  if (!existsSync(reportPath)) {
    process.stderr.write(`scenario lane ${lane.svc}: no report written at ${reportPath}\n`)
    anyFailed = true
    continue
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as VitestJson
  const passed = report.numPassedTests ?? 0
  const failed = report.numFailedTests ?? 0
  const skipped = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0)
  // False-green guard (mirrors foldVitestReport): success requires the report to claim success AND
  // at least one test to have run — a "no tests found" run can never fold as green.
  const ok = report.success === true && passed + failed + skipped > 0

  foldRunner(summaryPath, {
    name: lane.name,
    // One lane-level marker into totals (not the per-test counts — see the double-count note above).
    passed: ok ? 1 : 0,
    failed: ok ? 0 : 1,
    skipped: 0,
    duration_ms: 0,
    output: {
      runner: 'deterministic-fault-scenario',
      scope: `services/${lane.svc}`,
      success: ok,
      scenarios_passed: passed,
      scenarios_failed: failed,
      scenarios_skipped: skipped,
    },
    seeds: {},
  })
  folded += 1
  if (!ok) anyFailed = true
  process.stdout.write(
    `${lane.name} — ${passed} passed, ${failed} failed (folded as a lane marker)\n`,
  )
}

if (folded === 0) {
  process.stderr.write('no scenario reports folded — check the scenario specs exist\n')
  process.exit(2)
}
process.exit(anyFailed ? 1 : 0)
