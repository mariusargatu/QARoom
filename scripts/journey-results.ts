import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { foldRunner } from './lib/fold-runner'

/**
 * Fold the golden-journey vitest run (test-results/journey.json) into the frozen
 * test-results/summary.json envelope as a `journey` runner — mirrors scripts/chaos-results.ts.
 * The schema is do-not-touch; the journey rides its extensible per-runner `output`. Run after
 * the live walk:
 *
 *   pnpm journey:run && pnpm journey:results
 *
 * Gates on `report.success` too, not just the failed count: a suite-level crash (a beforeAll
 * port-forward throw, an import error) yields numFailedTests:0 but success:false — keying only
 * on failed would exit 0 (false-green) even though no journey actually ran.
 */
const ROOT = process.cwd()
const journeyPath = resolve(ROOT, 'test-results/journey.json')
const summaryPath = resolve(ROOT, 'test-results/summary.json')

if (!existsSync(journeyPath)) {
  process.stderr.write('no test-results/journey.json — run `pnpm journey:run` first\n')
  process.exit(2)
}

const report = JSON.parse(readFileSync(journeyPath, 'utf8'))
const fileDuration = (f: { startTime?: number; endTime?: number }) =>
  (f.endTime ?? 0) - (f.startTime ?? 0)
const durationMs = Math.round(
  (report.testResults ?? []).reduce(
    (sum: number, f: { startTime?: number; endTime?: number }) => sum + fileDuration(f),
    0,
  ),
)

const journeyRunner = {
  name: 'journey',
  passed: report.numPassedTests ?? 0,
  failed: report.numFailedTests ?? 0,
  skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
  duration_ms: durationMs,
  output: {
    runner: 'golden-journey-live',
    success: report.success === true,
    steps: (report.testResults ?? []).flatMap(
      (f: { assertionResults?: { title?: string; status?: string }[] }) =>
        (f.assertionResults ?? []).map((a) => ({ title: a.title, status: a.status })),
    ),
  },
}

foldRunner(summaryPath, journeyRunner)
process.stdout.write(
  `merged journey runner into summary.json — ${journeyRunner.passed} passed, ${journeyRunner.failed} failed\n`,
)
const passed = report.success === true && journeyRunner.failed === 0
process.exit(passed ? 0 : 1)
