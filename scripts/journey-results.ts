import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { foldVitestReport } from './lib/fold-runner'

/**
 * Fold the golden-journey vitest run (test-results/journey.json) into the frozen
 * test-results/summary.json envelope as a `journey` runner — mirrors scripts/chaos-results.ts.
 * The schema is do-not-touch; the journey rides its extensible per-runner `output`. Run after
 * the live walk:
 *
 *   pnpm journey:run && pnpm journey:results
 *
 * Gates on the false-green-aware `success` (report.success AND >0 tests ran), not just the failed
 * count: a suite-level crash (a beforeAll port-forward throw, an import error) yields
 * numFailedTests:0 but success:false — keying only on failed would exit 0 (false-green) even though
 * no journey actually ran.
 */
const ROOT = process.cwd()
const journeyPath = resolve(ROOT, 'test-results/journey.json')
const summaryPath = resolve(ROOT, 'test-results/summary.json')

if (!existsSync(journeyPath)) {
  process.stderr.write('no test-results/journey.json — run `pnpm journey:run` first\n')
  process.exit(2)
}

const { runner, success } = foldVitestReport(summaryPath, {
  name: 'journey',
  reportPath: journeyPath,
  runnerLabel: 'golden-journey-live',
  extraOutput: (report) => ({
    steps: (report.testResults ?? []).flatMap((f) =>
      (f.assertionResults ?? []).map((a) => ({ title: a.title, status: a.status })),
    ),
  }),
})

process.stdout.write(
  `merged journey runner into summary.json — ${runner.passed} passed, ${runner.failed} failed\n`,
)
process.exit(success && runner.failed === 0 ? 0 : 1)
