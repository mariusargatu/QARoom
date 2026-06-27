import { describe, expect, it } from 'vitest'
import { assertLegalOutboxCommit } from './outbox-invariant'

/**
 * The persisted-state projection of spec/tla/Outbox.tla's `Next` relation (ADR-0024, Phase 3; T19).
 * `relay.ts#publishOne` calls this before stamping `published_at`; the relay property/integration
 * suites exercise the same assertion on real rows end-to-end.
 */
describe('assertLegalOutboxCommit (Outbox.tla binding)', () => {
  it('accepts a successful publish: Pending -> Sent with publishOk', () => {
    expect(() => assertLegalOutboxCommit('Pending', 'Sent', true)).not.toThrow()
  })

  it('accepts a failed publish leaving the row pending: Pending -> Pending', () => {
    expect(() => assertLegalOutboxCommit('Pending', 'Pending', false)).not.toThrow()
  })

  it('rejects mark-sent without a successful publish (the lost-event bug)', () => {
    expect(() => assertLegalOutboxCommit('Pending', 'Sent', false)).toThrow(
      /mark-sent without a successful publish.*SentImpliesPublished/,
    )
  })

  it('rejects un-sending a delivered event (Sent is terminal)', () => {
    expect(() => assertLegalOutboxCommit('Sent', 'Pending', true)).toThrow(/illegal outbox commit/)
  })
})
