import { describe, expect, it } from 'vitest'
import { VOTE_VALUES, VoteValue, voteValueCheckSql } from './vote'

/**
 * The binding test: `VoteValue` (the readable literal union) and `VOTE_VALUES` (the single source the
 * DB CHECK + the fast-check arbitrary derive from) must describe the SAME set. Without this, the two
 * could silently diverge — a third value added to `VOTE_VALUES` but not the union, or vice versa,
 * would weaken one enforcement while the other held. This test fails the moment they disagree.
 */
describe('VoteValue ↔ VOTE_VALUES (single-source binding)', () => {
  it('VoteValue accepts exactly the VOTE_VALUES set', () => {
    for (const v of VOTE_VALUES) {
      expect(VoteValue.parse(v)).toBe(v)
    }
  })

  it('VoteValue rejects every out-of-range integer (0, 2, 7, -2, 100)', () => {
    for (const bad of [0, 2, 7, -2, 100]) {
      expect(VoteValue.safeParse(bad).success).toBe(false)
    }
  })

  it('voteValueCheckSql derives the DB predicate from VOTE_VALUES (no hand-typed bounds)', () => {
    expect(voteValueCheckSql('value')).toBe(`value IN (${VOTE_VALUES.join(', ')})`)
  })
})
