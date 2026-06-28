/**
 * The VERDICT logic — the single authority that turns a tier run's raw signal into one of
 * {green, red, flaky, inconclusive}. This is the heart of the promotion ledger AND its softest
 * Goodhart target: the cheapest path to a green `green_head` is not to fix the code, it is to relabel
 * a real RED as `flaky` (≈84% of nightly reds genuinely ARE flake, so the relabel hides in the
 * noise) or to lower the confirmation threshold so nothing is ever called red. That is why this file
 * is an INVARIANT SOURCE (CODEOWNERS) and why the meta-gate "measures the measure" — see
 * verdict.test.ts and `.github/workflows/promotion-ledger-guard.yml`.
 *
 * Verdicts attach to a BATCH first, then a red spawns a bisection that rewrites the range-red into
 * per-commit culprit rows (the O(log n) narrowing is named as Tier-B in ADR-0037; this module owns
 * the per-run classification it feeds on).
 */

export type Verdict = 'green' | 'red' | 'flaky' | 'inconclusive'

/** The raw signal from one tier run over one commit (or batch). Deterministic: no clock, no rng. */
export interface RunSignal {
  /** Test cases that failed on the first attempt. */
  readonly failed: number
  /** Test cases that passed. */
  readonly passed: number
  /**
   * Quarantine-and-confirm reruns performed on the failing cases (sparse-accounting discipline:
   * never attribute a red to a commit before confirming it reproduces).
   */
  readonly reruns: number
  /** Of those reruns, how many flipped fail→pass — the flake signal. */
  readonly rerunFlips: number
}

/**
 * The confirmation threshold (the "measure"): a failing run is only DOWNGRADED to `flaky` when a
 * strict majority of its confirmation reruns flipped fail→pass. Lowering this constant toward 0
 * relabels real reds as flaky — the exact Goodhart move the meta-gate watches for in a diff. It is
 * stated ONCE here and derived everywhere (the meta-gate recomputes against it, never a second copy).
 */
export const FLAKE_CONFIRM_RATIO = 0.5

/** The minimum culprit-confidence below which an auto-revert is NOT attributed to a commit. Tightening
 *  this toward 1 is the sibling Goodhart move (nothing clears the bar, so nothing ever reverts). */
export const MIN_CULPRIT_CONFIDENCE = 0.8

/**
 * The deliberate-bug toggle (detection-matrix `relabel-red-as-flaky`, claim
 * `relabeled-red-stays-red`). Armed, the verdict logic relabels EVERY real red as `flaky` — the
 * single cheapest way to advance `green_head` without fixing anything. Read at call-time so external
 * env injection (`pnpm prove relabeled-red-stays-red --break`) is honored, and the meta-gate reds.
 */
function relabelRedAsFlaky(): boolean {
  return process.env.LEDGER_RELABEL_RED_AS_FLAKY === '1'
}

/**
 * Classify one tier run. A confirmed flake (a strict majority of reruns flipped) is `flaky`; an
 * unconfirmed failure is a real `red`; no failures and at least one pass is `green`; a run that did
 * nothing is `inconclusive`. The toggle short-circuits a real red into `flaky` — never the reverse.
 */
export function classifyVerdict(signal: RunSignal): Verdict {
  if (signal.failed === 0) {
    return signal.passed > 0 ? 'green' : 'inconclusive'
  }
  const confirmedFlake =
    signal.reruns > 0 && signal.rerunFlips / signal.reruns > FLAKE_CONFIRM_RATIO
  if (relabelRedAsFlaky()) {
    // The Goodhart move, made visible: a real red is laundered into a flake to advance green_head.
    return 'flaky'
  }
  return confirmedFlake ? 'flaky' : 'red'
}
