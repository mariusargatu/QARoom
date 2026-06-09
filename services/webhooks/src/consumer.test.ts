import { describe, expect, it } from 'vitest'
import { classifyEventType, settleFailedDelivery, WEBHOOK_FANOUT_MAX_DELIVERIES } from './consumer'

/**
 * `classifyEventType` is the PURE part of the fan-out consumer (the rest needs a broker, so it is
 * integration-only). It maps a NATS `event-name` header to a `WebhookEventType` or null.
 */
describe('classifyEventType', () => {
  it('maps each known feed event-name to its WebhookEventType', () => {
    expect(classifyEventType('post.created')).toBe('post.created')
    expect(classifyEventType('vote.cast')).toBe('vote.cast')
    expect(classifyEventType('flag.state.changed')).toBe('flag.state.changed')
    expect(classifyEventType('donation.state.changed')).toBe('donation.state.changed')
    expect(classifyEventType('moderation.decision.recorded')).toBe('moderation.decision.recorded')
  })

  it('returns null for an event-name that is not a feed event type', () => {
    expect(classifyEventType('subscription.created')).toBeNull()
    expect(classifyEventType('post.created.extra')).toBeNull()
    expect(classifyEventType('')).toBeNull()
  })
})

/**
 * `settleFailedDelivery` is the broker-free decision that keeps the fan-out loop resilient: a
 * failing message is `nak`-ed for redelivery (at-least-once) until it has exhausted its delivery
 * budget, after which it is `term`-ed (dead-lettered) so a poison event cannot wedge the consumer.
 */
describe('settleFailedDelivery', () => {
  it('naks a first-attempt failure for redelivery (at-least-once)', () => {
    expect(settleFailedDelivery(1)).toEqual({ action: 'nak' })
  })

  it('naks every attempt below the delivery budget', () => {
    expect(settleFailedDelivery(WEBHOOK_FANOUT_MAX_DELIVERIES - 1)).toEqual({ action: 'nak' })
  })

  it('terms the message once it reaches the delivery budget (poison -> dead-letter)', () => {
    const settlement = settleFailedDelivery(WEBHOOK_FANOUT_MAX_DELIVERIES)
    expect(settlement.action).toBe('term')
  })

  it('terms the message past the delivery budget', () => {
    const settlement = settleFailedDelivery(WEBHOOK_FANOUT_MAX_DELIVERIES + 10)
    expect(settlement.action).toBe('term')
  })
})
