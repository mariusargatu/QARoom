import { describe, expect, it } from 'vitest'
import { classifyVerdict, FLAKE_CONFIRM_RATIO } from './verdict'

/**
 * The verdict logic + its META-GATE ("measure the measure", T24 / ADR-0037).
 *
 * The ledger is itself a Goodhart target: the cheapest path to a green green_head is to relabel a
 * real RED as `flaky`. The meta-gate below pins that down — a deterministic, reproducible failure is
 * a `red`, never a `flaky`. The deliberate-bug toggle LEDGER_RELABEL_RED_AS_FLAKY (claim
 * `relabeled-red-stays-red`) arms exactly that relabel; armed, the meta-gate reds. `pnpm prove
 * relabeled-red-stays-red --break` exercises it. This file NEVER arms the toggle itself (it is not
 * self-toggling), so only external injection turns it red — which is what makes the claim falsifiable.
 */
describe('classifyVerdict', () => {
  it('a real red is never relabeled flaky (the meta-gate measures the measure)', () => {
    // A failure that NO confirmation rerun flipped: genuinely reproducible. It must be a real red.
    const verdict = classifyVerdict({ failed: 3, passed: 10, reruns: 2, rerunFlips: 0 })
    expect(verdict).toBe('red')
  })

  it('downgrades to flaky only when a strict majority of reruns flipped fail→pass', () => {
    // 2 of 3 reruns flipped: above FLAKE_CONFIRM_RATIO — a confirmed flake.
    const verdict = classifyVerdict({ failed: 1, passed: 9, reruns: 3, rerunFlips: 2 })
    expect(verdict).toBe('flaky')
  })

  it('keeps a half-flipping failure a red (the ratio bar is strict, not met at exactly half)', () => {
    // 1 of 2 reruns flipped: exactly FLAKE_CONFIRM_RATIO, which is NOT a strict majority.
    const verdict = classifyVerdict({ failed: 1, passed: 9, reruns: 2, rerunFlips: 1 })
    expect(verdict).toBe('red')
  })

  it('calls an all-pass run green', () => {
    expect(classifyVerdict({ failed: 0, passed: 12, reruns: 0, rerunFlips: 0 })).toBe('green')
  })

  it('calls a run that did nothing inconclusive', () => {
    expect(classifyVerdict({ failed: 0, passed: 0, reruns: 0, rerunFlips: 0 })).toBe('inconclusive')
  })

  it('states the confirmation threshold once (the measure the meta-gate watches)', () => {
    expect(FLAKE_CONFIRM_RATIO).toBe(0.5)
  })
})
