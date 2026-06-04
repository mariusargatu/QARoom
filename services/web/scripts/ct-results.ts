import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { foldRunner } from '../../../scripts/lib/fold-runner'

/**
 * Fold the Playwright Component Test run into the frozen root test-results/summary.json as a `web-ct`
 * runner (Milestone 8). CT runs in Playwright (not Vitest), so the root aggregator can't see it — this
 * mirrors scripts/chaos-results.ts. Reads the JSON report `pnpm ct`/`ct:coverage` already emit
 * (playwright-ct.config.ts `reporter`) rather than re-running the suite. Run after a CT run:  pnpm ct:results
 */
const WEB = process.cwd()
const ROOT = resolve(WEB, '../..')
const summaryPath = resolve(ROOT, 'test-results/summary.json')
const reportPath = resolve(WEB, 'test-results/ct.json')

if (!existsSync(reportPath)) {
  process.stderr.write(
    'no services/web/test-results/ct.json — run `pnpm ct` (or ct:coverage) first\n',
  )
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
  name: 'web-ct',
  passed,
  failed,
  skipped: stats.skipped ?? 0,
  duration_ms: Math.round(stats.duration ?? 0),
  output: { runner: 'playwright-ct', success: failed === 0, flaky: stats.flaky ?? 0 },
  seeds: {},
})

process.stdout.write(
  `merged web-ct runner into summary.json — ${passed} passed, ${failed} failed\n`,
)
process.exit(failed === 0 ? 0 : 1)
