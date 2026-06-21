import { WEBHOOK_RETRY_POLICY } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { assertLegalDeliveryCommit } from './delivery-invariant'

const MAX = WEBHOOK_RETRY_POLICY.max_attempts

/**
 * The persisted-state projection of spec/tla/WebhookDelivery.tla's `Next` relation (ADR-0024,
 * Phase 3). These cases pin the legal-edge + exhaustion rules the worker enforces before every
 * commit; the live worker suites (delivery-guarantee, fanout, auto-disable) exercise the same
 * assertion end-to-end on real persisted rows.
 */
describe('assertLegalDeliveryCommit (WebhookDelivery.tla binding)', () => {
  it('accepts the legal committed edges from a re-claimable state', () => {
    expect(() => assertLegalDeliveryCommit('Pending', 'Delivered', 1, MAX)).not.toThrow()
    expect(() => assertLegalDeliveryCommit('Pending', 'Retrying', 1, MAX)).not.toThrow()
    expect(() => assertLegalDeliveryCommit('Retrying', 'Delivered', 3, MAX)).not.toThrow()
    expect(() => assertLegalDeliveryCommit('Retrying', 'DeadLettered', MAX, MAX)).not.toThrow()
  })

  it('rejects a commit from a non-reclaimable state (illegal Next edge)', () => {
    expect(() => assertLegalDeliveryCommit('Delivering', 'Delivered', 1, MAX)).toThrow(/illegal/)
    expect(() => assertLegalDeliveryCommit('Delivered', 'Retrying', 1, MAX)).toThrow(/illegal/)
  })

  it('rejects a premature dead-letter (violates ExhaustionLegit)', () => {
    expect(() => assertLegalDeliveryCommit('Retrying', 'DeadLettered', MAX - 1, MAX)).toThrow(
      /premature dead-letter/,
    )
  })

  it('rejects an off-protocol target state', () => {
    expect(() => assertLegalDeliveryCommit('Pending', 'Delivering', 1, MAX)).toThrow(/illegal/)
  })
})
