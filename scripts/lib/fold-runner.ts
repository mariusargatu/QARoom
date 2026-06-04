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
 * write. The single home for that invariant — `k6`/`stryker`/`evomaster`/`web-ct`/`chaos` result
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
