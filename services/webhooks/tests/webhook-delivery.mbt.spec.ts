import {
  applyWebhookDeliveryEvent,
  type WebhookDeliveryStateName,
  webhookDeliveryMachine,
} from '@qaroom/contracts'
import type { Clock } from '@qaroom/determinism'
import { assertModelMatchesSystem, assertPathCount, shortestPaths } from '@qaroom/testing-utils/mbt'
import { describe, expect, it } from 'vitest'

/**
 * Model-based testing of the webhook-delivery machine. Every shortest path through the model is
 * replayed against the runner (the component the worker drives transitions through); the runner
 * must reach exactly the state the model predicts at every step. A broken edge in the runner makes
 * EXACTLY the path(s) through it fail, and the failure names the divergent state.
 */
const fixedClock: Clock = { now: () => new Date('2026-06-05T00:00:00.000Z') }
const SUPPORTED_EVENTS = [
  'AttemptStarted',
  'DeliverySucceeded',
  'DeliveryFailed',
  'RetriesExhausted',
]

const paths = shortestPaths(webhookDeliveryMachine, { maxDepth: 10 })

describe('model-based webhook-delivery conformance', () => {
  it('the model matches the system (initial state + every event has an endpoint)', () => {
    assertModelMatchesSystem(webhookDeliveryMachine, {
      initialState: 'Pending',
      supportedEvents: SUPPORTED_EVENTS,
    })
  })

  it('generates at least one path per reachable state', () => {
    const targets = new Set(paths.map((p) => p.target))
    expect(targets.size).toBe(5) // Pending, Delivering, Delivered, Retrying, DeadLettered
    assertPathCount(paths, { floor: 4, cap: 50 })
  })

  it.each(paths.map((p) => ({ p, name: p.description })))('runner honors model path: $name', ({
    p,
  }) => {
    let state: WebhookDeliveryStateName = 'Pending'
    p.steps.forEach((step) => {
      const result = applyWebhookDeliveryEvent(state, step.event as never, { clock: fixedClock })
      state = result.to
      expect(state).toBe(JSON.parse(step.state))
    })
    expect(state).toBe(JSON.parse(p.target))
  })
})
