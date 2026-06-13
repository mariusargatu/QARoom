import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { foldRunner } from '../../../scripts/lib/fold-runner'

/**
 * Fold the Playwright end-to-end run into the frozen root test-results/summary.json as a `web-e2e`
 * runner (mirrors scripts/ct-results.ts). The model-based E2E suite runs in Playwright (not Vitest),
 * so the root aggregator can't see it. Reads the JSON report `pnpm e2e` already emits
 * (playwright.config.ts `reporter`) rather than re-running the suite. Run after an e2e run:
 *   pnpm e2e:results
 */
const WEB = process.cwd()
const ROOT = resolve(WEB, '../..')
const summaryPath = resolve(ROOT, 'test-results/summary.json')
const reportPath = resolve(WEB, 'test-results/e2e.json')

if (!existsSync(reportPath)) {
  process.stderr.write('no services/web/test-results/e2e.json — run `pnpm e2e` first\n')
  process.exit(2)
}

interface PwJson {
  stats?: {
    expected?: number
    unexpected?: number
    skipped?: number
    flaky?: number
    duration?: number
  }
}

const report = JSON.parse(readFileSync(reportPath, 'utf8')) as PwJson
const stats = report.stats ?? {}
const passed = stats.expected ?? 0
const failed = stats.unexpected ?? 0

foldRunner(summaryPath, {
  name: 'web-e2e',
  passed,
  failed,
  skipped: stats.skipped ?? 0,
  duration_ms: Math.round(stats.duration ?? 0),
  output: { runner: 'playwright-e2e', success: failed === 0, flaky: stats.flaky ?? 0 },
  seeds: {},
})

process.stdout.write(
  `merged web-e2e runner into summary.json — ${passed} passed, ${failed} failed\n`,
)
process.exit(failed === 0 ? 0 : 1)
