import type { TestResultsSummary } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { runCensus } from './test-results-verify'

type FakeRunner = { name: string; output: { runner: string } }

// Minimal summary carrying only the fields runCensus reads (schema_version, totals, runners). The
// seed runner is the vitest aggregate (output.runner === 'vitest'), so the aggregate-present check
// passes and the only variables under test are totals.failed and any extra runners. Cast because we
// deliberately omit the rest of the frozen envelope the census never inspects.
function summaryWith(failed: number, extra: FakeRunner[] = []): TestResultsSummary {
  return {
    schema_version: 1,
    totals: { passed: 10, failed },
    runners: [{ name: '@qaroom/content', output: { runner: 'vitest' } }, ...extra],
  } as unknown as TestResultsSummary
}

describe('runCensus false-green guard', () => {
  it('is census-clean when no test failed', () => {
    expect(runCensus(summaryWith(0), 'in-proc')).toBe(0)
  })

  it('turns RED when the summary records a failed test (cannot validate green)', () => {
    expect(runCensus(summaryWith(3), 'in-proc')).toBeGreaterThan(0)
  })
})

describe('runCensus undeclared-runner gate (registry vs summary.json)', () => {
  it('turns RED when a runner folds into summary.json with no registry row', () => {
    const summary = summaryWith(0, [{ name: 'not-a-real-runner', output: { runner: 'custom' } }])
    expect(runCensus(summary, 'in-proc')).toBeGreaterThan(0)
  })

  it('accepts a runner that is declared in scripts/lib/runners.ts', () => {
    const summary = summaryWith(0, [
      { name: 'scenario:content', output: { runner: 'deterministic-fault-scenario' } },
    ])
    expect(runCensus(summary, 'in-proc')).toBe(0)
  })
})
