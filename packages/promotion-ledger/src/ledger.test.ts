import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  append,
  evidenceHash,
  highestGreenTier,
  isGreenAtTier,
  LedgerRow,
  parseLedger,
  serializeRow,
} from './ledger'

const baseRow: LedgerRow = {
  commit_sha: 'abc123',
  tier: 'POSTSUBMIT_GREEN',
  verdict: 'green',
  evidence_hash: 'deadbeef',
  batch_range: { from: 'abc123', to: 'abc123' },
  culprit_confidence: 1,
  ts: 1700000000000,
}

describe('append', () => {
  it('returns a new ledger and never mutates the input', () => {
    const before: readonly LedgerRow[] = []
    const after = append(before, baseRow)
    expect(after).toHaveLength(1)
    expect(before).toHaveLength(0)
  })

  it('rejects a malformed row (out-of-band culprit confidence)', () => {
    expect(() => append([], { ...baseRow, culprit_confidence: 2 })).toThrow()
  })
})

describe('evidenceHash', () => {
  it('is content-addressed: stable across key order', () => {
    const a = evidenceHash({ commit: 'x', totals: { passed: 1, failed: 0 } })
    const b = evidenceHash({ totals: { failed: 0, passed: 1 }, commit: 'x' })
    expect(a).toBe(b)
  })

  it('changes when the evidence changes', () => {
    const a = evidenceHash({ totals: { passed: 1, failed: 0 } })
    const b = evidenceHash({ totals: { passed: 1, failed: 1 } })
    expect(a).not.toBe(b)
  })
})

describe('serialize / parse round-trip', () => {
  it('parses back exactly what it serialized', () => {
    const jsonl = [serializeRow(baseRow), serializeRow({ ...baseRow, ts: baseRow.ts + 1 })].join(
      '\n',
    )
    const rows = parseLedger(`${jsonl}\n`)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual(baseRow)
  })

  it('round-trips an arbitrary valid row', () => {
    fc.assert(
      fc.property(
        fc.record({
          commit_sha: fc.string({
            minLength: 1,
            maxLength: 40,
            unit: fc.constantFrom(...'0123456789abcdef'),
          }),
          ts: fc.integer({ min: 0, max: 2_000_000_000_000 }),
          culprit_confidence: fc.float({ min: 0, max: 1, noNaN: true }),
        }),
        (partial) => {
          const r = LedgerRow.parse({ ...baseRow, ...partial })
          expect(parseLedger(serializeRow(r))[0]).toEqual(r)
        },
      ),
    )
  })
})

describe('isGreenAtTier', () => {
  it('is true when a commit is green at or above the target', () => {
    const ledger = append([], { ...baseRow, tier: 'NIGHTLY_GREEN' })
    expect(isGreenAtTier(ledger, 'abc123', 'POSTSUBMIT_GREEN')).toBe(true)
    expect(highestGreenTier(ledger, 'abc123')).toBe('NIGHTLY_GREEN')
  })

  it('is false below the target', () => {
    const ledger = append([], { ...baseRow, tier: 'PRESUBMIT_GREEN' })
    expect(isGreenAtTier(ledger, 'abc123', 'POSTSUBMIT_GREEN')).toBe(false)
  })

  it('is false while an outstanding revert stands, true once a later green clears it', () => {
    const reverted = append(append([], baseRow), {
      ...baseRow,
      tier: 'NIGHTLY_GREEN',
      verdict: 'red',
      ts: baseRow.ts + 1,
    })
    expect(isGreenAtTier(reverted, 'abc123', 'POSTSUBMIT_GREEN')).toBe(false)

    const cleared = append(reverted, {
      ...baseRow,
      tier: 'NIGHTLY_GREEN',
      verdict: 'green',
      ts: baseRow.ts + 2,
    })
    expect(isGreenAtTier(cleared, 'abc123', 'POSTSUBMIT_GREEN')).toBe(true)
  })

  it('is false for an unknown commit', () => {
    expect(isGreenAtTier(append([], baseRow), 'never-seen', 'SUBMITTED')).toBe(false)
  })
})
