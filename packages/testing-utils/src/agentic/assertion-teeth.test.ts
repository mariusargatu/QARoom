import { describe, expect, it } from 'vitest'
import { mutationKillRatio, runAgentOracle, tally } from './assertion-teeth'

/**
 * The mutation gate for the `agent-test-has-teeth` claim (Boundary 16, ADR-0032). The guarantee: the
 * agent-authored oracle reds on every mutated target — it has teeth. Under
 * `AGENT_EMIT_ASSERTIONLESS_TEST` the matcher stops asserting, the mutants survive, the kill ratio
 * falls to 0, and this test goes RED (`pnpm prove agent-test-has-teeth --break`). There is no branch
 * on the toggle here: the env read lives entirely in `agentAssert` (the SUT), so the test is
 * unconditional.
 */
describe('agentic boundary: mutation gives an assertion-less agent test no teeth', () => {
  it('the agent oracle kills every mutant of the target (its assertions have teeth)', () => {
    // Sanity: the oracle is green for the correct implementation, so a red is a real survivor, not
    // a vacuously-red oracle.
    expect(runAgentOracle(tally)).toBe(true)
    // The gate: every non-equivalent mutant is caught. Neuter the matcher and the ratio falls to 0.
    expect(mutationKillRatio()).toBe(1)
  })
})
