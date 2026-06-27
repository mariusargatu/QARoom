import { describe, expect, it } from 'vitest'
import { auditVoteValueArbConformance } from './deriver-conformance'

/**
 * The deriver-conformance gate for the `deriver-conformance` claim (Boundary 16, ADR-0033). The
 * guarantee: the property generator `voteValueArb` emits exactly the set its single source
 * (`VOTE_VALUES`) sanctions — so weakening the deriver while leaving the CODEOWNED invariant pristine
 * (the cheapest derivation-chain tamper, spike C3) is caught. Under `AGENT_WEAKEN_VOTE_DERIVER` the
 * deriver broadens its domain to admit an out-of-set `2`, the recompute-and-diff disagrees, and this
 * test goes RED (`pnpm prove deriver-conformance --break`). No branch on the toggle here: the env read
 * lives entirely in the deriver (the SUT), so the assertion is unconditional.
 */
describe('agentic boundary: the vote-value deriver conforms to its single source', () => {
  it('the vote deriver emits exactly the VOTE_VALUES set (a weakened deriver reds this)', () => {
    const result = auditVoteValueArbConformance()
    // The recompute-and-diff: nothing emitted beyond the source set, nothing in the source unemitted.
    expect(result.extra).toEqual([])
    expect(result.missing).toEqual([])
    expect(result.ok).toBe(true)
  })
})
