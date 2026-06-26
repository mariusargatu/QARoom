import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { foldVitestReport } from '../../../scripts/lib/fold-runner'

/**
 * Fold the Vitest-browser component-test run into the frozen root test-results/summary.json as a
 * `web-component` runner (ADR-0027, supersedes the `web-ct` fold of scripts/ct-results.ts). The
 * Screenplay component suite runs in its own Vitest browser project (vitest.component.config.ts), not
 * the node `pnpm test` aggregate, so the root aggregator can't see it. Reads the JSON report the run
 * already emits rather than re-running it. Run after a component run:  pnpm test:component:results
 */
const WEB = process.cwd()
const ROOT = resolve(WEB, '../..')
const summaryPath = resolve(ROOT, 'test-results/summary.json')
const reportPath = resolve(WEB, 'test-results/component.json')

if (!existsSync(reportPath)) {
  process.stderr.write(
    'no services/web/test-results/component.json — run `pnpm test:component` first\n',
  )
  process.exit(2)
}

const { success, totals } = foldVitestReport(summaryPath, {
  name: 'web-component',
  reportPath,
  runnerLabel: 'vitest-browser',
})

process.stdout.write(
  `merged web-component runner into summary.json — ${totals.passed} passed, ${totals.failed} failed\n`,
)
process.exit(success ? 0 : 1)
