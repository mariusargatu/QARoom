import type { TestResultsSummary } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { deriveFoldedRunnerNames, runCensus } from './test-results-verify'

// Minimal summary carrying only the fields runCensus reads (schema_version, totals, runners). Cast
// because we deliberately omit the rest of the frozen envelope the census never inspects — the point
// is to exercise the false-green guard, not the schema (test-results:verify's other half does that).
function summaryWith(failed: number): TestResultsSummary {
  return {
    schema_version: 1,
    totals: { passed: 10, failed },
    runners: [{ name: 'mbt-edge-coverage', output: { runner: 'vitest' } }],
  } as unknown as TestResultsSummary
}

// Real derived roster so rosterDrift contributes no findings (it is drift-free in the repo) and the
// only variable under test is totals.failed.
const folded = deriveFoldedRunnerNames()

describe('runCensus false-green guard', () => {
  it('is census-clean when no test failed', () => {
    expect(runCensus(summaryWith(0), 'in-proc', folded)).toBe(0)
  })

  it('turns RED when the summary records a failed test (cannot validate green)', () => {
    expect(runCensus(summaryWith(3), 'in-proc', folded)).toBeGreaterThan(0)
  })
})
