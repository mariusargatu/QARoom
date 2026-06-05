import { describe, expect, it } from 'vitest'
import { createConventionsOracle } from './oracle'

const oracle = createConventionsOracle()

describe('the conventions oracle', () => {
  it('flags a direct Date construction as a determinism leak', () => {
    const verdict = oracle.check({ code: 'export const stamp = () => new Date()' })
    expect(verdict.ok).toBe(false)
    expect(verdict.violations.map((violation) => violation.rule)).toContain('no-new-date')
  })

  it('passes production code that reads the injected clock', () => {
    const verdict = oracle.check({ code: 'export const stamp = (clock) => clock.now()' })
    expect(verdict.ok).toBe(true)
  })

  it('applies the test rule-set when the filename is a test file', () => {
    const verdict = oracle.check({
      code: "it('keeps the invariant under load', () => { if (ready) expect(1).toBe(1) })",
      filename: 'feature.test.ts',
    })
    expect(verdict.violations.map((violation) => violation.rule)).toContain(
      'no-conditional-in-test',
    )
  })

  it('reports which rules it checked alongside the verdict', () => {
    const verdict = oracle.check({ code: 'export const value = 1', rules: ['no-new-date'] })
    expect(verdict.checked_rules).toEqual(['no-new-date'])
  })
})
