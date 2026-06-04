import { globSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { foldRunner } from './lib/fold-runner'

/**
 * Fold the k6 load runs (test-results/k6-*.json, written by each script's handleSummary) into the
 * frozen test-results/summary.json envelope as a single `k6` runner. The schema is do-not-touch; k6
 * rides its extensible per-runner `output`. A breached SLO threshold (k6 exit 99) counts as a
 * failed script. Run after the k6 scripts:  pnpm k6:results
 */
const ROOT = process.cwd()
const summaryPath = resolve(ROOT, 'test-results/summary.json')
const files = globSync('test-results/k6-*.json', { cwd: ROOT }).sort()

if (files.length === 0) {
  process.stderr.write('no test-results/k6-*.json — run a load-tests/*.js script first\n')
  process.exit(2)
}

interface ThresholdResult {
  ok?: boolean
}
interface Metric {
  values?: Record<string, number>
  thresholds?: Record<string, ThresholdResult>
}
interface K6Summary {
  metrics?: Record<string, Metric>
  state?: { testRunDurationMs?: number }
}

const scripts = files.map((rel) => {
  const data = JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8')) as K6Summary
  const metrics = data.metrics ?? {}
  const breaches: string[] = []
  for (const [name, metric] of Object.entries(metrics)) {
    for (const [expr, res] of Object.entries(metric.thresholds ?? {})) {
      if (res.ok === false) breaches.push(`${name}: ${expr}`)
    }
  }
  const waiting = metrics['http_req_waiting{scenario:measure}']?.values ?? {}
  return {
    script: basename(rel).replace(/^k6-|\.json$/g, ''),
    passed: breaches.length === 0,
    breaches,
    latency_ms: { p50: waiting['p(50)'], p95: waiting['p(95)'], p99: waiting['p(99)'] },
    error_rate: metrics['http_req_failed{scenario:measure}']?.values?.rate,
    duration_ms: Math.round(data.state?.testRunDurationMs ?? 0),
  }
})

const failed = scripts.filter((s) => !s.passed).length
const k6Runner = {
  name: 'k6',
  passed: scripts.length - failed,
  failed,
  skipped: 0,
  duration_ms: scripts.reduce((sum, s) => sum + s.duration_ms, 0),
  output: { runner: 'k6', success: failed === 0, scripts },
  seeds: {},
}

foldRunner(summaryPath, k6Runner)
process.stdout.write(
  `merged k6 runner into summary.json — ${k6Runner.passed} passed, ${k6Runner.failed} failed\n`,
)
process.exit(failed === 0 ? 0 : 1)
