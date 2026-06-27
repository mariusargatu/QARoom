/**
 * Boundary 16 — agentic development as a tested boundary (ADR-0032). The deterministic, in-process
 * twin of `pnpm stryker:harness` (ADR-0031) behind the `agent-test-has-teeth` claim.
 *
 * Threat model. ImpossibleBench measured GPT-5 cheating 76% of the time — editing tests, forcing
 * `__eq__` to return True, special-casing the checked input. ADR-0016 names the same risk one level
 * down: a weakened assertion launders a false green into every suite that trusts it. So an
 * agent-authored test is itself an UNTRUSTED input — an assertion-less ("always-pass") oracle
 * compiles, runs green, and silently removes severity. The defender is mutation testing: a test that
 * does not red on a mutated target has no teeth.
 *
 * This module is a miniature but real mutation gate — a real target, real mutation operators, a real
 * kill check — so the mechanism is falsifiable in milliseconds without standing up the full Stryker
 * toolchain (the heavyweight harness surface stays ADR-0031's `stryker:harness`).
 *
 * `AGENT_EMIT_ASSERTIONLESS_TEST` arms the attack: `agentAssert` stops asserting (the `__eq__`→True
 * always-pass matcher). Armed, the agent oracle passes against every mutant — the mutants survive —
 * the kill ratio drops to 0, and the gate reds. This is the ONE place the env var is read; it is
 * unguarded (no production-mode predicate) so the detection-matrix census classifies it cleanly.
 */

/** The pure target under test: a post's net score is upvotes minus downvotes. */
export function tally(upvotes: number, downvotes: number): number {
  return upvotes - downvotes
}

/** A mutated implementation of {@link tally}, paired with the operator class it models. */
export interface Mutant {
  readonly name: string
  readonly fn: (upvotes: number, downvotes: number) => number
}

/**
 * Mutation operators applied to {@link tally} — each a non-equivalent variant a thorough oracle must
 * kill (operator swap, operand swap, term drop, off-by-one): the classic mutation classes, not a toy.
 */
export const MUTANTS: readonly Mutant[] = [
  { name: 'arithmetic-operator-swap (minus to plus)', fn: (u, d) => u + d },
  { name: 'operand-swap (u-d to d-u)', fn: (u, d) => d - u },
  { name: 'term-drop (ignore downvotes)', fn: (u) => u },
  { name: 'off-by-one (+1)', fn: (u, d) => u - d + 1 },
]

/**
 * The neuterable matcher. Normally throws on mismatch (a real assertion); under
 * `AGENT_EMIT_ASSERTIONLESS_TEST` it returns without asserting — the always-pass attack. Read at call
 * time so an externally-armed run (`prove --break`, the matrix sweep) is honored mid-process.
 */
export function agentAssert(actual: number, expected: number): void {
  if (process.env.AGENT_EMIT_ASSERTIONLESS_TEST === '1') return
  if (actual !== expected) {
    throw new Error(`agentAssert: expected ${expected}, got ${actual}`)
  }
}

/**
 * The agent-authored oracle: example checks over an implementation of the target, written through
 * {@link agentAssert}. Returns true when every check passes (the oracle is green for this impl), false
 * when any check throws (the impl was caught). A GOOD oracle is true for {@link tally} and false for
 * every mutant.
 */
export function runAgentOracle(impl: (upvotes: number, downvotes: number) => number): boolean {
  try {
    agentAssert(impl(3, 1), 2)
    agentAssert(impl(0, 0), 0)
    agentAssert(impl(2, 5), -3)
    agentAssert(impl(1, 0), 1)
    return true
  } catch {
    return false
  }
}

/** Mutation kill ratio: the fraction of mutants the agent oracle reds on (1 = every mutant killed). */
export function mutationKillRatio(): number {
  const killed = MUTANTS.filter((m) => !runAgentOracle(m.fn)).length
  return killed / MUTANTS.length
}
