import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { foldRunner, foldVitestReport } from './fold-runner'

// The honesty layer's load-bearing logic: the sole writer of the frozen test-results/summary.json
// and the false-green guard that stops an empty report from folding as a pass. These had zero tests;
// a bug here (mis-summed totals, a swallowed failure, a non-idempotent re-fold) would silently
// corrupt the one artifact every claims/census gate reads.

let dir: string
let summaryPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qaroom-fold-'))
  summaryPath = join(dir, 'summary.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const runner = (name: string, p: number, f: number, s: number) => ({
  name,
  passed: p,
  failed: f,
  skipped: s,
  duration_ms: 1,
  output: { runner: 'vitest', success: f === 0 },
  seeds: {},
})

const read = () => JSON.parse(readFileSync(summaryPath, 'utf8'))

describe('foldRunner', () => {
  it('initializes a fresh envelope when no summary exists', () => {
    const totals = foldRunner(summaryPath, runner('content', 10, 0, 1))
    expect(totals).toEqual({ passed: 10, failed: 0, skipped: 1 })
    const summary = read()
    expect(summary.schema_version).toBe(1)
    expect(summary.runners).toHaveLength(1)
    expect(summary.totals).toEqual({ passed: 10, failed: 0, skipped: 1 })
  })

  it('sums totals across multiple distinct runners', () => {
    foldRunner(summaryPath, runner('content', 10, 0, 0))
    const totals = foldRunner(summaryPath, runner('gateway', 5, 2, 1))
    expect(totals).toEqual({ passed: 15, failed: 2, skipped: 1 })
    expect(read().runners).toHaveLength(2)
  })

  it('is idempotent: re-folding the same runner name replaces, never duplicates', () => {
    foldRunner(summaryPath, runner('content', 10, 0, 0))
    foldRunner(summaryPath, runner('content', 10, 0, 0))
    const summary = read()
    expect(summary.runners).toHaveLength(1)
    expect(summary.totals.passed).toBe(10)
  })

  it('replaces a prior runner result with the latest (a re-run that now fails is not hidden)', () => {
    foldRunner(summaryPath, runner('content', 10, 0, 0))
    const totals = foldRunner(summaryPath, runner('content', 8, 2, 0))
    expect(totals).toEqual({ passed: 8, failed: 2, skipped: 0 })
    expect(read().runners).toHaveLength(1)
  })

  it('writes an envelope that re-parses (stays schema-valid across folds)', () => {
    foldRunner(summaryPath, runner('content', 1, 0, 0))
    expect(() => foldRunner(summaryPath, runner('gateway', 1, 0, 0))).not.toThrow()
    expect(
      read()
        .runners.map((r: { name: string }) => r.name)
        .sort(),
    ).toEqual(['content', 'gateway'])
  })
})

describe('foldVitestReport false-green guard', () => {
  const writeReport = (report: unknown): string => {
    const p = join(dir, 'vitest.json')
    writeFileSync(p, JSON.stringify(report))
    return p
  }

  it('treats a passing report that actually ran tests as success', () => {
    const reportPath = writeReport({
      success: true,
      numPassedTests: 12,
      numFailedTests: 0,
      numPendingTests: 0,
      testResults: [{ name: 'a', status: 'passed', startTime: 0, endTime: 50 }],
    })
    const res = foldVitestReport(summaryPath, { name: 'svc', reportPath, runnerLabel: 'vitest' })
    expect(res.success).toBe(true)
    expect(res.runner.passed).toBe(12)
    expect(res.runner.duration_ms).toBe(50)
  })

  it('rejects an empty report as a false green (success:true but zero tests ran)', () => {
    const reportPath = writeReport({
      success: true,
      numPassedTests: 0,
      numFailedTests: 0,
      numPendingTests: 0,
      testResults: [],
    })
    const res = foldVitestReport(summaryPath, { name: 'svc', reportPath, runnerLabel: 'vitest' })
    expect(res.success).toBe(false)
  })

  it('reports failure when any test failed', () => {
    const reportPath = writeReport({
      success: false,
      numPassedTests: 5,
      numFailedTests: 1,
      numPendingTests: 0,
      testResults: [{ name: 'a', status: 'failed', startTime: 0, endTime: 10 }],
    })
    const res = foldVitestReport(summaryPath, { name: 'svc', reportPath, runnerLabel: 'vitest' })
    expect(res.success).toBe(false)
    expect(res.runner.failed).toBe(1)
  })

  it('throws when the report file is absent (cannot fold a runner that never wrote output)', () => {
    expect(() =>
      foldVitestReport(summaryPath, {
        name: 'svc',
        reportPath: join(dir, 'missing.json'),
        runnerLabel: 'vitest',
      }),
    ).toThrow(/no vitest report/)
  })
})
