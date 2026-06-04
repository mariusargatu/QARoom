import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TestResultsSummary } from '@qaroom/contracts'

/**
 * Fold the chaos vitest run (test-results/chaos.json) into the frozen
 * test-results/summary.json envelope as a `chaos` runner. The schema is do-not-touch; chaos
 * rides its extensible per-runner `output: Record<string, unknown>`. Run in the nightly tier
 * AFTER `pnpm test-results:generate` and `pnpm chaos:run`:
 *
 *   pnpm chaos:run && pnpm chaos:results
 *
 * If summary.json is absent (chaos-only run), a minimal envelope is created.
 */
const ROOT = process.cwd()
const chaosPath = resolve(ROOT, 'test-results/chaos.json')
const summaryPath = resolve(ROOT, 'test-results/summary.json')

if (!existsSync(chaosPath)) {
  process.stderr.write('no test-results/chaos.json — run `pnpm chaos:run` first\n')
  process.exit(2)
}

const report = JSON.parse(readFileSync(chaosPath, 'utf8'))
const fileDuration = (f: { startTime?: number; endTime?: number }) =>
  (f.endTime ?? 0) - (f.startTime ?? 0)
const durationMs = Math.round(
  (report.testResults ?? []).reduce(
    (sum: number, f: { startTime?: number; endTime?: number }) => sum + fileDuration(f),
    0,
  ),
)

const chaosRunner = {
  name: 'chaos',
  passed: report.numPassedTests ?? 0,
  failed: report.numFailedTests ?? 0,
  skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
  duration_ms: durationMs,
  output: {
    runner: 'chaos-mesh+litmus',
    success: report.success === true,
    experiments: (report.testResults ?? []).map((f: { name?: string; status?: string }) => ({
      file: f.name,
      status: f.status,
    })),
  },
}

const base = existsSync(summaryPath)
  ? JSON.parse(readFileSync(summaryPath, 'utf8'))
  : { schema_version: 1, generated_at: new Date().toISOString(), totals: {}, runners: [] }

const runners = [...base.runners.filter((r: { name: string }) => r.name !== 'chaos'), chaosRunner]
const totals = runners.reduce(
  (acc: { passed: number; failed: number; skipped: number }, r: typeof chaosRunner) => ({
    passed: acc.passed + r.passed,
    failed: acc.failed + r.failed,
    skipped: acc.skipped + r.skipped,
  }),
  { passed: 0, failed: 0, skipped: 0 },
)

const summary = TestResultsSummary.parse({ ...base, totals, runners })
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
process.stdout.write(
  `merged chaos runner into summary.json — ${chaosRunner.passed} passed, ${chaosRunner.failed} failed\n`,
)
// Gate on report.success too, not just the failed count: a suite-level crash (a beforeAll /
// port-forward throw, an import error) produces numFailedTests:0 but success:false — keying only
// on failed would exit 0 (false-green) even though no chaos experiment actually ran.
const passed = report.success === true && chaosRunner.failed === 0
process.exit(passed ? 0 : 1)
