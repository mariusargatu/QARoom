import { describe, expect, it } from 'vitest'
import {
  RUNNER_TIERS,
  RUNNERS_WITHOUT_RESULTS_SCRIPT,
  deriveFoldedRunnerNames,
} from '../test-results-verify'
import { COVERAGE_BACKEND_GAP, RUNNERS, runnerNames } from './runners'

/**
 * Meta-collapse PR-A gate: prove scripts/lib/runners.ts is a FAITHFUL SUPERSET of the two witnesses
 * scripts/test-results-verify.ts currently uses — the source-deriving regex (deriveFoldedRunnerNames)
 * and the hand-kept RUNNER_TIERS map. Once green, PR-B can point the census + claims-verify at RUNNERS
 * alone and delete the regex (and the `spec`→`specPath` distortion its `(?!spec:)` lookahead forced),
 * knowing nothing the old pair classified is lost. This test is temporary — PR-B removes the witnesses
 * it compares against and replaces this with a registry-vs-summary.json drift test.
 */
describe('runners registry — faithful superset of the current census witnesses (PR-A)', () => {
  it('covers every runner the source-deriving regex finds (witness A)', () => {
    const names = runnerNames()
    const uncovered = [...deriveFoldedRunnerNames()].filter((n) => !names.has(n)).sort()
    expect(uncovered).toEqual([])
  })

  it('covers every classified runner, with the same tier (witness B)', () => {
    const names = runnerNames()
    const tierByName = new Map(RUNNERS.map((r) => [r.name, r.tier]))
    const missing = Object.keys(RUNNER_TIERS)
      .filter((n) => !names.has(n))
      .sort()
    expect(missing).toEqual([])
    const tierMismatches = Object.entries(RUNNER_TIERS)
      .filter(([n, t]) => tierByName.get(n) !== t)
      .map(([n, t]) => `${n}: registry=${tierByName.get(n)} expected=${t}`)
      .sort()
    expect(tierMismatches).toEqual([])
  })

  it('adds exactly the coverage:<backend> rows neither witness can see (the closed gap)', () => {
    const netNew = RUNNERS.map((r) => r.name)
      .filter((n) => !(n in RUNNER_TIERS))
      .sort()
    expect(netNew).toEqual([...COVERAGE_BACKEND_GAP].sort())
  })

  it('marks every side-channel/standalone runner external (the dispatcher must not own them)', () => {
    const byName = new Map(RUNNERS.map((r) => [r.name, r]))
    const notExternal = [...RUNNERS_WITHOUT_RESULTS_SCRIPT]
      .filter((n) => byName.get(n)?.foldKind !== 'external')
      .sort()
    expect(notExternal).toEqual([])
  })

  it('is well-formed: unique names, and external ⇔ has foldedBy', () => {
    const names = RUNNERS.map((r) => r.name)
    expect(names.length).toBe(new Set(names).size)
    const externalWithoutFoldedBy = RUNNERS.filter(
      (r) => r.foldKind === 'external' && !r.foldedBy,
    ).map((r) => r.name)
    expect(externalWithoutFoldedBy).toEqual([])
    const dispatchedWithFoldedBy = RUNNERS.filter(
      (r) => r.foldKind !== 'external' && r.foldedBy,
    ).map((r) => r.name)
    expect(dispatchedWithFoldedBy).toEqual([])
  })
})
