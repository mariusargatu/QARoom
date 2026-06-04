import { describe, expect, it } from 'vitest'
import { SLO_TARGETS } from './slos'
import { parseSlosDocTable } from './slos-doc'

/**
 * Drift guard (Milestone 8): the prose SLO table in `docs/slos.md` and the in-code `SLO_TARGETS`
 * are two views of one fact. This pins them equal so neither can drift — the same discipline
 * `ids.test.ts` uses for the branded-id regex. The parsing lives in `slos-doc.ts` (conditionals are
 * forbidden in test files).
 */
describe('SLO_TARGETS', () => {
  const byRoute = new Map(parseSlosDocTable().map((r) => [r.route, r]))

  it('documents exactly the SLO_TARGETS endpoints', () => {
    expect(byRoute.size).toBe(Object.keys(SLO_TARGETS).length)
  })

  it.each(Object.entries(SLO_TARGETS))('matches docs/slos.md for %s', (_key, target) => {
    expect(byRoute.get(target.route)).toEqual(target)
  })
})
