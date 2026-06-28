/**
 * The promotion TIER ladder (T24, ADR-0037). A risk ladder, NOT a time ladder: a tier is a
 * statement about how much evidence a commit has survived, not how old it is. `true_head` (the last
 * merged commit) is not deployable; `green_head` is a SEPARATE, lagging pointer advanced only as a
 * commit climbs this ladder (Google TAP's true_head ≠ green_head).
 *
 * Order is load-bearing: a higher rank means MORE evidence survived, so "≥ deploy target" is a rank
 * comparison. The ladder is the single source for that order — `tierRank` derives from the array, so
 * the order is stated once.
 */

export const TIERS = [
  'SUBMITTED',
  'PRESUBMIT_GREEN',
  'POSTSUBMIT_GREEN',
  'NIGHTLY_GREEN',
  'WEEKLY_GREEN',
  'CANARY_GREEN',
] as const

export type Tier = (typeof TIERS)[number]

/** Rank of a tier in the ladder (0 = SUBMITTED). Higher = more evidence survived. */
export function tierRank(tier: Tier): number {
  return TIERS.indexOf(tier)
}

/** `a` carries at least as much evidence as `b`. */
export function tierAtLeast(a: Tier, b: Tier): boolean {
  return tierRank(a) >= tierRank(b)
}
