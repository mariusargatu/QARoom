import { describe, expect, it } from 'vitest'
import { COVERAGE_BACKEND_GAP, RUNNERS, runnerNames } from './runners'

const TIERS = new Set(['in-proc', 'cluster', 'optional'])
const FOLD_KINDS = new Set(['vitest', 'eval', 'custom', 'external'])

/**
 * The registry is now the single source the census (test-results-verify.ts) and claims-verify read,
 * so its internal consistency is load-bearing. These tests guard that — there is no longer a second
 * witness to cross-check against (that pair, and the regex distortion it forced, were the thing PR-B
 * removed); the empirical witness lives in test-results-verify.test.ts (registry vs a real summary).
 */
describe('runners registry — well-formed single source of truth', () => {
  it('has unique runner names', () => {
    const names = RUNNERS.map((r) => r.name)
    expect(names.length).toBe(new Set(names).size)
  })

  it('uses only valid tiers and fold kinds', () => {
    const badTier = RUNNERS.filter((r) => !TIERS.has(r.tier)).map((r) => r.name)
    const badKind = RUNNERS.filter((r) => !FOLD_KINDS.has(r.foldKind)).map((r) => r.name)
    expect(badTier).toEqual([])
    expect(badKind).toEqual([])
  })

  it('declares foldedBy iff the runner is external (the dispatcher must not own externals)', () => {
    const externalWithoutFoldedBy = RUNNERS.filter(
      (r) => r.foldKind === 'external' && !r.foldedBy,
    ).map((r) => r.name)
    const dispatchedWithFoldedBy = RUNNERS.filter(
      (r) => r.foldKind !== 'external' && r.foldedBy,
    ).map((r) => r.name)
    expect(externalWithoutFoldedBy).toEqual([])
    expect(dispatchedWithFoldedBy).toEqual([])
  })

  it('tracks the coverage:<backend> family the dynamic-name fold would otherwise hide', () => {
    const names = runnerNames()
    const missing = COVERAGE_BACKEND_GAP.filter((n) => !names.has(n))
    expect(missing).toEqual([])
    const wrongTier = COVERAGE_BACKEND_GAP.filter(
      (n) => RUNNERS.find((r) => r.name === n)?.tier !== 'optional',
    )
    expect(wrongTier).toEqual([])
  })
})
