import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { foldVitestReport } from './lib/fold-runner'

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

const { runner, success } = foldVitestReport(summaryPath, {
  name: 'chaos',
  reportPath: chaosPath,
  runnerLabel: 'chaos-mesh+litmus',
  extraOutput: (report) => ({
    experiments: (report.testResults ?? []).map((f) => ({ file: f.name, status: f.status })),
  }),
})

process.stdout.write(
  `merged chaos runner into summary.json — ${runner.passed} passed, ${runner.failed} failed\n`,
)
// Gate on the false-green-aware `success` (report.success AND >0 tests ran), not just the failed
// count: a suite-level crash (a beforeAll / port-forward throw, an import error) produces
// numFailedTests:0 but success:false — keying only on failed would exit 0 (false-green) even though
// no chaos experiment actually ran.
process.exit(success && runner.failed === 0 ? 0 : 1)
