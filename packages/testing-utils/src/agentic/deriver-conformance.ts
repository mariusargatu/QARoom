import { VOTE_VALUES } from '@qaroom/contracts'
import fc from 'fast-check'
import { voteValueArb } from '../generators/post'

/**
 * Boundary 16 — agentic development as a tested boundary (ADR-0032), the T23 derivation-chain
 * governance (ADR-0033). The threat the spike found (C3): governing the SOURCE is not enough. The
 * `±1` rule lives in the CODEOWNED `VOTE_VALUES`, but the property generator that DERIVES from it
 * (`voteValueArb`, `packages/testing-utils/src/generators/post.ts`) is not codeowned — so the cheapest
 * tamper is to leave the invariant pristine and weaken the deriver, and the source-only guard never
 * sees it. The toggle `AGENT_WEAKEN_VOTE_DERIVER` arms exactly that move.
 *
 * The fix (spike C4): a DERIVER-CONFORMANCE check that recomputes the expected derived projection
 * straight from the source and diffs it against what the deriver actually emits. This is NOT auditing
 * a function against itself: it SAMPLES the real `voteValueArb` (the artifact every vote property test
 * draws from) and compares its observed value set to the set recomputed from `VOTE_VALUES`. A faithful
 * deriver matches; a weakened one (broadened domain, dropped value, swapped engine) reds. It observes
 * real output, so a hand-edit that swaps `fc.constantFrom(...VOTE_VALUES)` for `fc.integer({min,max})`
 * is caught the same way the env toggle is.
 */

/** A determinism-pinned sample: a fixed seed + a generous run count so the observed set is stable and
 *  every constant a small `constantFrom` can emit is actually drawn (no flaky coverage gap). */
const SAMPLE_SEED = 0x7a3
const SAMPLE_RUNS = 256

export interface ConformanceResult {
  readonly ok: boolean
  /** The set recomputed straight from the source of truth. */
  readonly expected: readonly number[]
  /** The set the deriver actually emitted, observed by sampling. */
  readonly observed: readonly number[]
  /** Values the deriver emits that the source does not sanction (a broadened domain). */
  readonly extra: readonly number[]
  /** Values the source sanctions that the deriver never emits (a dropped value). */
  readonly missing: readonly number[]
  readonly detail: string
}

const sortedUnique = (values: readonly number[]): number[] =>
  [...new Set(values)].sort((a, b) => a - b)

/**
 * Audit the vote-value arbitrary against its single source. Recomputes the expected set from
 * `VOTE_VALUES`, samples the live `voteValueArb`, and diffs. Pure + deterministic (fixed seed).
 */
export function auditVoteValueArbConformance(): ConformanceResult {
  const expected = sortedUnique(VOTE_VALUES)
  const observed = sortedUnique(
    fc.sample(voteValueArb, { numRuns: SAMPLE_RUNS, seed: SAMPLE_SEED }),
  )
  const expectedSet = new Set(expected)
  const observedSet = new Set(observed)
  const extra = observed.filter((v) => !expectedSet.has(v))
  const missing = expected.filter((v) => !observedSet.has(v))
  const ok = extra.length === 0 && missing.length === 0
  const detail = ok
    ? `voteValueArb emits exactly the VOTE_VALUES set {${expected.join(', ')}}`
    : `voteValueArb has drifted from VOTE_VALUES {${expected.join(', ')}}: ` +
      `${extra.length > 0 ? `emits unsanctioned {${extra.join(', ')}}` : ''}` +
      `${extra.length > 0 && missing.length > 0 ? '; ' : ''}` +
      `${missing.length > 0 ? `never emits {${missing.join(', ')}}` : ''}`
  return { ok, expected, observed, extra, missing, detail }
}
