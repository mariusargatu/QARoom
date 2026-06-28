import { isGreenAtTier, type LedgerRow } from './ledger'
import type { Tier } from './tiers'

/**
 * `green_head` — the deployable pointer (T24, ADR-0037). NOT the last merged commit (`true_head`):
 * it is the longest CONTIGUOUS commit prefix all ≥ the deploy target with no outstanding revert.
 * Deploy only from here. A single red in the middle of the line caps green_head at the commit BEFORE
 * it, even when later commits are individually green — contiguity is the point, because deploying a
 * later green would carry the intervening red along with it.
 *
 * `commits` is the merge-ordered history (oldest first); each must be a real sha. The function is
 * pure over (commits, ledger, target) — same inputs, same pointer.
 */
export function greenHead(
  commits: readonly string[],
  ledger: readonly LedgerRow[],
  target: Tier,
): string | null {
  let head: string | null = null
  for (const sha of commits) {
    if (!isGreenAtTier(ledger, sha, target)) break
    head = sha
  }
  return head
}

/** How far green_head lags true_head: the count of merged commits NOT yet deployable. The
 *  always-positive-or-zero gap Google TAP keeps visible (merged ≠ deployable). */
export function greenHeadLag(
  commits: readonly string[],
  ledger: readonly LedgerRow[],
  target: Tier,
): number {
  const head = greenHead(commits, ledger, target)
  if (head === null) return commits.length
  return commits.length - (commits.indexOf(head) + 1)
}
