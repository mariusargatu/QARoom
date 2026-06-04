import { globSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { calculateMetrics } from 'mutation-testing-metrics'
import { foldRunner } from './lib/fold-runner'

/**
 * Fold the per-package Stryker reports (test-results/stryker-*.json) into the frozen
 * test-results/summary.json envelope as a single `stryker` runner. The schema is do-not-touch;
 * Stryker rides its extensible per-runner `output`. A module below its own `thresholds.break` counts
 * as a failed module. The Stryker JSON has no computed score, so `mutation-testing-metrics` computes
 * it. Run after `pnpm stryker:critical`:  pnpm stryker:results
 */
const ROOT = process.cwd()
const summaryPath = resolve(ROOT, 'test-results/summary.json')
const files = globSync('test-results/stryker-*.json', { cwd: ROOT }).sort()

if (files.length === 0) {
  process.stderr.write('no test-results/stryker-*.json — run `pnpm stryker:critical` first\n')
  process.exit(2)
}

interface StrykerReport {
  files: Record<string, unknown>
  thresholds?: { break?: number | null }
}

const modules = files.map((rel) => {
  const report = JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8')) as StrykerReport
  const metrics = calculateMetrics(report.files).metrics
  const score = metrics.mutationScore
  const breakAt = report.thresholds?.break ?? 0
  return {
    pkg: basename(rel).replace(/^stryker-|\.json$/g, ''),
    mutationScore: Number(score.toFixed(2)),
    killed: metrics.killed,
    survived: metrics.survived,
    noCoverage: metrics.noCoverage,
    timeout: metrics.timeout,
    break: breakAt,
    belowBreak: score < breakAt,
  }
})

const failed = modules.filter((m) => m.belowBreak).length
const strykerRunner = {
  name: 'stryker',
  passed: modules.length - failed,
  failed,
  skipped: 0,
  duration_ms: 0,
  output: { runner: 'stryker', success: failed === 0, modules },
  seeds: {},
}

foldRunner(summaryPath, strykerRunner)
for (const m of modules) {
  process.stdout.write(
    `  ${m.pkg}: ${m.mutationScore}% (killed ${m.killed}, survived ${m.survived}, no-cov ${m.noCoverage}) break ${m.break}${m.belowBreak ? ' ✗' : ' ✓'}\n`,
  )
}
process.stdout.write(
  `merged stryker runner into summary.json — ${strykerRunner.passed} passed, ${failed} failed\n`,
)
process.exit(failed === 0 ? 0 : 1)
