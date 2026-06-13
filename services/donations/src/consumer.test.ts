import { describe, expect, it } from 'vitest'
import { FLAG_CONSUMER_MAX_DELIVERIES, settleFailedFlagDelivery } from './consumer'

/**
 * `settleFailedFlagDelivery` is the broker-free decision that keeps the flag-cache consumer
 * resilient (the same shape as the webhooks fan-out settle): a failing message is `nak`-ed for
 * redelivery (at-least-once) until it has exhausted its delivery budget, after which it is
 * `term`-ed (dead-lettered) so a poison event cannot wedge the durable consumer.
 */
describe('settleFailedFlagDelivery', () => {
  it('naks a first-attempt failure for redelivery (at-least-once)', () => {
    expect(settleFailedFlagDelivery(1)).toEqual({ action: 'nak' })
  })

  it('naks every attempt below the delivery budget', () => {
    expect(settleFailedFlagDelivery(FLAG_CONSUMER_MAX_DELIVERIES - 1)).toEqual({ action: 'nak' })
  })

  it('terms the message once it reaches the delivery budget (poison -> dead-letter)', () => {
    const settlement = settleFailedFlagDelivery(FLAG_CONSUMER_MAX_DELIVERIES)
    expect(settlement.action).toBe('term')
  })

  it('terms the message past the delivery budget', () => {
    const settlement = settleFailedFlagDelivery(FLAG_CONSUMER_MAX_DELIVERIES + 10)
    expect(settlement.action).toBe('term')
  })
})
