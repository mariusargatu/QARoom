import { createHash } from 'node:crypto'
import { z } from 'zod'
import { TIERS, type Tier, tierAtLeast } from './tiers'
import type { Verdict } from './verdict'

/**
 * The PROMOTION LEDGER — append-only, content-addressed, keyed by commit_sha. It is the single
 * authority for "is SHA X deployable at tier T", a SIDECAR to the FROZEN test-results/summary.json
 * (Commitment 14): a row's `evidence_hash` REFERENCES a summary envelope without modifying its
 * schema. The on-disk form is JSONL at test-results/promotion-ledger.jsonl (gitignored like every
 * other test-results artifact); this module is pure — the caller stamps `ts` and does the file I/O
 * (there is no clock here; `Date.now()` is both forbidden and unavailable).
 */

const VERDICTS = ['green', 'red', 'flaky', 'inconclusive'] as const

/** A commit range a batch verdict attaches to before bisection narrows it to per-commit rows. */
export const BatchRange = z.object({ from: z.string().min(1), to: z.string().min(1) }).strict()
export type BatchRange = z.infer<typeof BatchRange>

export const LedgerRow = z
  .object({
    commit_sha: z.string().min(1),
    tier: z.enum(TIERS),
    verdict: z.enum(VERDICTS),
    /** Content address of the summary.json envelope this verdict was computed from. */
    evidence_hash: z.string().min(1),
    /** The batch a verdict first attached to (a single-commit batch has from === to). */
    batch_range: BatchRange,
    /** Confidence the named commit is the culprit (1 for a single-commit batch; lower mid-bisection). */
    culprit_confidence: z.number().min(0).max(1),
    /** Caller-stamped epoch millis. Passed IN — this module never reads the clock. */
    ts: z.number().int().nonnegative(),
  })
  .strict()
export type LedgerRow = z.infer<typeof LedgerRow>

/** A content-addressed hash of any evidence object (e.g. the summary.json envelope). Stable across
 *  key order so two structurally-equal envelopes hash identically. */
export function evidenceHash(evidence: unknown): string {
  return createHash('sha256').update(stableStringify(evidence)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/** Append a validated row, returning a NEW ledger (immutable — never mutate the input). */
export function append(ledger: readonly LedgerRow[], row: LedgerRow): readonly LedgerRow[] {
  return [...ledger, LedgerRow.parse(row)]
}

/** Serialize one row to a JSONL line (the on-disk append unit). */
export function serializeRow(row: LedgerRow): string {
  return JSON.stringify(LedgerRow.parse(row))
}

/** Parse a JSONL ledger body into validated rows (blank lines ignored). Throws on a malformed row. */
export function parseLedger(jsonl: string): readonly LedgerRow[] {
  return jsonl
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => LedgerRow.parse(JSON.parse(line)))
}

/** Every row recorded for one commit (content-addressed by commit_sha). */
export function rowsFor(ledger: readonly LedgerRow[], sha: string): readonly LedgerRow[] {
  return ledger.filter((r) => r.commit_sha === sha)
}

/** The highest tier at which a commit has a GREEN verdict, or null if it never went green. */
export function highestGreenTier(ledger: readonly LedgerRow[], sha: string): Tier | null {
  return rowsFor(ledger, sha)
    .filter((r) => r.verdict === 'green')
    .reduce<Tier | null>(
      (best, r) => (best === null || tierAtLeast(r.tier, best) ? r.tier : best),
      null,
    )
}

/**
 * An OUTSTANDING REVERT: the commit has a `red` verdict that no later green at the same-or-higher
 * tier has cleared. A red culprit sha stays red in TAP — a fix is a NEW commit — so this is sticky.
 */
export function hasOutstandingRevert(ledger: readonly LedgerRow[], sha: string): boolean {
  return rowsFor(ledger, sha).some((red) => {
    if (red.verdict !== 'red') return false
    return !ledger.some(
      (g) => g.commit_sha === sha && g.verdict === 'green' && tierAtLeast(g.tier, red.tier),
    )
  })
}

/**
 * The query at the centre of the ledger: is SHA X deployable at tier T? True iff it has a green
 * verdict at tier ≥ T AND carries no outstanding revert. (Deployable trust is a SEPARATE, lagging
 * pointer — this is the per-commit predicate `green_head` is the contiguous-prefix closure of.)
 */
export function isGreenAtTier(ledger: readonly LedgerRow[], sha: string, target: Tier): boolean {
  if (hasOutstandingRevert(ledger, sha)) return false
  const best = highestGreenTier(ledger, sha)
  return best !== null && tierAtLeast(best, target)
}
