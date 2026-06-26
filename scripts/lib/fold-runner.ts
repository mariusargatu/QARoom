import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { type RunnerResult, TestResultsSummary } from '@qaroom/contracts'

interface Totals {
  passed: number
  failed: number
  skipped: number
}

/**
 * Fold one runner's result into the frozen `test-results/summary.json` envelope (Commitment 14):
 * load-or-init the base envelope, replace any prior entry with the same `name` (so re-runs are
 * idempotent), recompute totals, validate against the do-not-touch `TestResultsSummary` schema, and
 * write. The single home for that invariant — `k6`/`stryker`/`evomaster`/`web-component`/`chaos` result
 * scripts each parse their own tool's output into a `RunnerResult` and call this. Returns the new
 * totals so the caller owns its exit code.
 *
 * NOTE: in CI each result script runs in an isolated job from a fresh checkout, so the
 * load-or-init branch usually creates a fresh envelope (no cross-job folding); the merge path is
 * for local sequential runs. The `new Date()` default is fine here — this is build tooling, not the
 * deterministic service runtime (the Clock rule covers the latter).
 */
export function foldRunner(summaryPath: string, runner: RunnerResult): Totals {
  const base = existsSync(summaryPath)
    ? JSON.parse(readFileSync(summaryPath, 'utf8'))
    : { schema_version: 1, generated_at: new Date().toISOString(), totals: {}, runners: [] }

  const runners: RunnerResult[] = [
    ...base.runners.filter((r: { name: string }) => r.name !== runner.name),
    runner,
  ]
  const totals = runners.reduce<Totals>(
    (acc, r) => ({
      passed: acc.passed + r.passed,
      failed: acc.failed + r.failed,
      skipped: acc.skipped + r.skipped,
    }),
    { passed: 0, failed: 0, skipped: 0 },
  )

  const summary = TestResultsSummary.parse({ ...base, totals, runners })
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
  return totals
}

/** One file entry of a Vitest `--reporter=json` report — only the fields the fold reads. */
interface VitestFileResult {
  name?: string
  status?: string
  startTime?: number
  endTime?: number
  assertionResults?: { title?: string; status?: string }[]
}

/** Minimal shape of a Vitest `--reporter=json` report. */
interface VitestJsonReport {
  numPassedTests?: number
  numFailedTests?: number
  numPendingTests?: number
  numTodoTests?: number
  success?: boolean
  testResults?: VitestFileResult[]
}

export interface FoldVitestReportOptions {
  /** Runner display name (e.g. `chaos`, `journey`, or a workspace package name). */
  name: string
  /** Absolute path to the Vitest `--reporter=json` output. */
  reportPath: string
  /** `output.runner` label (e.g. `vitest`, `chaos-mesh+litmus`, `golden-journey-live`). */
  runnerLabel: string
  /** Per-runner property/fuzzing seeds (defaults to `{}`, matching the schema default). */
  seeds?: Record<string, unknown>
  /** Extra `output{}` fields derived from the report (e.g. `experiments`, `steps`). */
  extraOutput?: (report: VitestJsonReport) => Record<string, unknown>
}

export interface FoldVitestReportResult {
  /** Cross-runner totals returned by `foldRunner` — used by the multi-runner aggregate sweep. */
  totals: Totals
  /** The single `RunnerResult` this call folded — used by single-runner callers to gate/print. */
  runner: RunnerResult
  /**
   * False-green-aware pass flag for THIS runner: the report claims `success` AND it actually ran at
   * least one test. Single-runner callers (chaos/journey) gate on this — gating on cross-runner
   * `totals.failed` would wrongly couple their exit to other runners during local sequential folds.
   */
  success: boolean
}

/**
 * Read one Vitest `--reporter=json` report, map it to a `RunnerResult`, and fold it into
 * `summary.json` via {@link foldRunner}. This is the single home for the read+parse+map+duration+
 * false-green block that scripts/aggregate-test-results.ts, scripts/chaos-results.ts and
 * scripts/journey-results.ts each hand-copied. The caller still owns its exit code: gate on the
 * returned `success` (single-runner chaos/journey) or on `totals.failed` (the aggregate sweep).
 *
 * False-green guard (strictest of the three originals): a MISSING report throws — callers that want
 * a softer exit code (chaos/journey exit 2, the aggregate sweep `continue`s) pre-check `existsSync`
 * and never reach this throw. An EMPTY report (0 tests) yields `success:false` even if the JSON
 * claims `success:true`, so a "no test files found" run can never fold as green.
 */
export function foldVitestReport(
  summaryPath: string,
  opts: FoldVitestReportOptions,
): FoldVitestReportResult {
  if (!existsSync(opts.reportPath)) {
    throw new Error(`no vitest report at ${opts.reportPath} for runner "${opts.name}"`)
  }

  const report = JSON.parse(readFileSync(opts.reportPath, 'utf8')) as VitestJsonReport
  const fileDuration = (f: VitestFileResult) => (f.endTime ?? 0) - (f.startTime ?? 0)
  const durationMs = Math.round(
    (report.testResults ?? []).reduce((sum, f) => sum + fileDuration(f), 0),
  )

  const passed = report.numPassedTests ?? 0
  const failed = report.numFailedTests ?? 0
  const skipped = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0)

  const runner: RunnerResult = {
    name: opts.name,
    passed,
    failed,
    skipped,
    duration_ms: durationMs,
    output: {
      runner: opts.runnerLabel,
      success: report.success === true,
      ...opts.extraOutput?.(report),
    },
    seeds: opts.seeds ?? {},
  }

  const totals = foldRunner(summaryPath, runner)
  const success = report.success === true && passed + failed + skipped > 0
  return { totals, runner, success }
}
