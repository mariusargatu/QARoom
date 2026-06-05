import type { Clock } from '@qaroom/determinism'
import { describe, expect, it } from 'vitest'
import {
  applyWebhookDeliveryEvent,
  type WebhookDeliveryTransitionRecord,
} from './webhook-delivery.runner'

const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) })

function recordingSink() {
  const records: WebhookDeliveryTransitionRecord[] = []
  return { records, record: (t: WebhookDeliveryTransitionRecord) => records.push(t) }
}

describe('applyWebhookDeliveryEvent', () => {
  it('applies a legal event and reports the resulting transition as changed', () => {
    const result = applyWebhookDeliveryEvent('Pending', 'AttemptStarted', {
      clock: fixedClock('2026-06-05T00:00:00.000Z'),
    })
    expect(result.changed).toBe(true)
    expect(result.from).toBe('Pending')
    expect(result.to).toBe('Delivering')
    expect(result.transition?.at).toBe('2026-06-05T00:00:00.000Z')
  })

  it('reports an illegal event as unchanged without inventing a transition', () => {
    const sink = recordingSink()
    const result = applyWebhookDeliveryEvent('Pending', 'DeliverySucceeded', {
      clock: fixedClock('2026-06-05T00:00:00.000Z'),
      sink,
    })
    expect(result.changed).toBe(false)
    expect(result.from).toBe('Pending')
    expect(result.to).toBe('Pending')
    expect(result.transition).toBeUndefined()
    expect(sink.records).toHaveLength(0)
  })

  it('emits each real transition to the sink with the injected clock stamp', () => {
    const sink = recordingSink()
    applyWebhookDeliveryEvent('Delivering', 'DeliveryFailed', {
      clock: fixedClock('2026-06-05T01:02:03.000Z'),
      sink,
    })
    expect(sink.records).toEqual([
      {
        from: 'Delivering',
        to: 'Retrying',
        event: 'DeliveryFailed',
        at: '2026-06-05T01:02:03.000Z',
      },
    ])
  })

  it('starts the actor from the given current state, not the machine initial state', () => {
    // If the runner ignored currentState and always started at Pending, DeliverySucceeded would
    // be illegal (changed:false). Reaching Delivered proves it resumed from Delivering.
    const result = applyWebhookDeliveryEvent('Delivering', 'DeliverySucceeded', {
      clock: fixedClock('2026-06-05T00:00:00.000Z'),
    })
    expect(result.changed).toBe(true)
    expect(result.to).toBe('Delivered')
  })
})
