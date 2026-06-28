import { describe, expect, it } from 'vitest'
import { greenHead, greenHeadLag } from './green-head'
import type { Tier, Verdict } from './index'
import { append, type LedgerRow } from './ledger'

/**
 * green_head: the longest contiguous deployable prefix (T24 / ADR-0037). The cases that matter are
 * the ones where green_head ≠ true_head — a too-low tier, and a red mid-line that caps the prefix
 * even though later commits are individually green (the contiguity-with-revert case).
 */

let nextTs = 1
function row(commit_sha: string, tier: Tier, verdict: Verdict): LedgerRow {
  nextTs += 1
  return {
    commit_sha,
    tier,
    verdict,
    evidence_hash: `hash-${commit_sha}-${tier}`,
    batch_range: { from: commit_sha, to: commit_sha },
    culprit_confidence: 1,
    ts: nextTs,
  }
}

function ledgerOf(rows: readonly LedgerRow[]): readonly LedgerRow[] {
  return rows.reduce<readonly LedgerRow[]>((acc, r) => append(acc, r), [])
}

const COMMITS = ['c1', 'c2', 'c3', 'c4']

describe('greenHead', () => {
  it('returns the whole line when every commit is green at the target tier', () => {
    const ledger = ledgerOf(COMMITS.map((c) => row(c, 'POSTSUBMIT_GREEN', 'green')))
    expect(greenHead(COMMITS, ledger, 'POSTSUBMIT_GREEN')).toBe('c4')
  })

  it('lags true_head by the commits below the deploy target', () => {
    // c1,c2 reached POSTSUBMIT; c3,c4 only PRESUBMIT — green_head stops at c2 for a POSTSUBMIT target.
    const ledger = ledgerOf([
      row('c1', 'POSTSUBMIT_GREEN', 'green'),
      row('c2', 'POSTSUBMIT_GREEN', 'green'),
      row('c3', 'PRESUBMIT_GREEN', 'green'),
      row('c4', 'PRESUBMIT_GREEN', 'green'),
    ])
    expect(greenHead(COMMITS, ledger, 'POSTSUBMIT_GREEN')).toBe('c2')
    expect(greenHeadLag(COMMITS, ledger, 'POSTSUBMIT_GREEN')).toBe(2)
  })

  it('caps green_head BEFORE a red even when later commits are green (contiguity)', () => {
    // c3 has an outstanding revert; c4 is green again — but deploying c4 carries c3, so green_head = c2.
    const ledger = ledgerOf([
      row('c1', 'POSTSUBMIT_GREEN', 'green'),
      row('c2', 'POSTSUBMIT_GREEN', 'green'),
      row('c3', 'POSTSUBMIT_GREEN', 'red'),
      row('c4', 'POSTSUBMIT_GREEN', 'green'),
    ])
    expect(greenHead(COMMITS, ledger, 'POSTSUBMIT_GREEN')).toBe('c2')
  })

  it('clears an outstanding revert once a later green at ≥ the red tier supersedes it', () => {
    // c3 went red at PRESUBMIT then green at POSTSUBMIT (a higher tier) — the revert is cleared.
    const ledger = ledgerOf([
      row('c1', 'POSTSUBMIT_GREEN', 'green'),
      row('c2', 'POSTSUBMIT_GREEN', 'green'),
      row('c3', 'PRESUBMIT_GREEN', 'red'),
      row('c3', 'POSTSUBMIT_GREEN', 'green'),
      row('c4', 'POSTSUBMIT_GREEN', 'green'),
    ])
    expect(greenHead(COMMITS, ledger, 'POSTSUBMIT_GREEN')).toBe('c4')
  })

  it('is null when even the first commit is not deployable', () => {
    const ledger = ledgerOf([row('c1', 'SUBMITTED', 'inconclusive')])
    expect(greenHead(COMMITS, ledger, 'POSTSUBMIT_GREEN')).toBeNull()
    expect(greenHeadLag(COMMITS, ledger, 'POSTSUBMIT_GREEN')).toBe(4)
  })

  it('is null on an empty line', () => {
    expect(greenHead([], [], 'PRESUBMIT_GREEN')).toBeNull()
  })
})
