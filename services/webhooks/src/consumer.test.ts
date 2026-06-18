import { describe, expect, it } from 'vitest'
import { classifyEventType } from './consumer'

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

// The pure delivery-budget settle decision (`nak` until the budget is exhausted, then poison `term`)
// now lives in @qaroom/messaging (`settleByDeliveryBudget`) with its canonical unit test there; the
// fan-out consumer wires it. The broker-backed fan-out behaviour is covered by tests/fanout.spec.ts.
