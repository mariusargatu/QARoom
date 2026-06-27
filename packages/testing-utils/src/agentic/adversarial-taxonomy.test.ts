import { describe, expect, it } from 'vitest'
import { ATTACK_TAXONOMY, runAdversarialTaxonomy } from './adversarial-taxonomy'

/**
 * The permanent gate behind `scripts/prove-adversarial.ts` (Boundary 16, ADR-0033). The guarantee:
 * the `prove --break` mutants are seeded from the NAMED attack taxonomy (ImpossibleBench / METR /
 * Anthropic), not the author's imagination, and each one is BOTH a real cheat (a weak check greens it)
 * AND caught by its designated defense (the named gate reds it). A future weakening — dropping a
 * defense, neutering the property oracle — flips one of these and reds the gate. The loop iterates a
 * fixed array (parameterized assertions, not a branch).
 */
describe('agentic boundary: the adversarial attack taxonomy', () => {
  it('covers the four named attacks from the empirical record', () => {
    expect(ATTACK_TAXONOMY.map((a) => a.id)).toEqual([
      'equals-true',
      'exit-zero',
      'special-casing',
      'state-recording',
    ])
  })

  it('each named cheat greens a weak check (it is real theater) yet is caught by its designated gate', () => {
    const verdicts = runAdversarialTaxonomy()
    expect(verdicts).toHaveLength(4)
    for (const v of verdicts) {
      // C1 — a weak check passes it, so it is a genuine cheat, not a strawman.
      expect(v.greensWeakCheck).toBe(true)
      // C2 — the designated defense still reds it: the named gate has teeth against this attack.
      expect(v.caught).toBe(true)
    }
  })
})
