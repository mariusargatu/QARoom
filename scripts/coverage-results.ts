import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { foldRunner } from './lib/fold-runner'

/**
 * Fold the unified web coverage (Vitest V8 + Playwright CT Istanbul, merged by monocart in
 * services/web/scripts/merge-coverage.ts) into the frozen test-results/summary.json envelope as a
 * `coverage` runner. The merge has worked since Milestone 8 but its numbers never reached the
 * summary (the "merged but not folded" gap) — this closes it. Informational, not a gate: the
 * runner always folds as passed; thresholds, if ever wanted, belong to a separate decision.
 *
 * Run after:  pnpm --filter @qaroom/web run ct:coverage
 *             pnpm --filter @qaroom/web run test:stories:coverage
 *             pnpm --filter @qaroom/web run coverage:merge
 */
const ROOT = process.cwd()
const summaryPath = resolve(ROOT, 'test-results/summary.json')
const mergedDir = resolve(ROOT, 'services/web/coverage/merged')

const reportPath = resolve(mergedDir, 'coverage-summary.json')

if (!existsSync(reportPath)) {
  process.stderr.write(
    'no coverage-summary.json in services/web/coverage/merged — run the web coverage lane first\n' +
      '(ct:coverage, test:stories:coverage, coverage:merge in services/web)\n',
  )
  process.exit(2)
}

interface Metric {
  total?: number
  covered?: number
  pct?: number
}
// monocart's json-summary reporter emits the istanbul shape: { total: { lines: {...}, ... } }.
const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
  total?: Record<string, Metric>
}
const summary = report.total ?? {}

const pick = (key: string): Metric => summary[key] ?? {}
const metrics = {
  lines: pick('lines'),
  branches: pick('branches'),
  functions: pick('functions'),
  statements: pick('statements'),
}

if (metrics.lines.pct === undefined) {
  process.stderr.write(`could not read a lines.pct summary from ${reportPath} — format drift?\n`)
  process.exit(2)
}

const runner = {
  name: 'coverage',
  passed: 1,
  failed: 0,
  skipped: 0,
  duration_ms: 0,
  output: {
    runner: 'monocart-merged-v8+istanbul',
    scope: 'services/web',
    source: reportPath.slice(ROOT.length + 1),
    ...metrics,
  },
  seeds: {},
}

foldRunner(summaryPath, runner)
process.stdout.write(
  `merged coverage runner into summary.json — web lines ${metrics.lines.pct}%, branches ${metrics.branches.pct ?? '?'}%\n`,
)
