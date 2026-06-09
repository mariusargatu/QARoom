import {
  applyWebhookDeliveryEvent,
  type WebhookDeliveryStateName,
  webhookDeliveryMachine,
} from '@qaroom/contracts'
import type { Clock } from '@qaroom/determinism'
import {
  allEdges,
  assertModelMatchesSystem,
  assertPathCount,
  coverageReport,
  edgeKey,
  edgeRecorder,
  edgesOfPaths,
  shortestPaths,
} from '@qaroom/testing-utils/mbt'
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

/**
 * All-transitions coverage (the 0-switch criterion). Shortest paths reach every state but never
 * cross the retry RE-ATTEMPT edge — `Retrying --AttemptStarted--> Delivering` returns to a
 * visited state, so it is on no shortest path. That edge is the heart of the at-least-once
 * story; a bug on it would hide behind a green path-replay suite forever. The gap is driven
 * deterministically through the same runner and the union must reach 5/5.
 */
describe('all-transitions coverage of the webhook-delivery machine', () => {
  const EDGES = allEdges(webhookDeliveryMachine)
  const PATH_EDGES = edgesOfPaths(paths, 'Pending')
  const GAP = coverageReport(EDGES, PATH_EDGES).gap
  const gapFill = edgeRecorder()

  it('shortest paths leave exactly the retry re-attempt edge uncovered', () => {
    expect(GAP.map(edgeKey)).toEqual(['Retrying|AttemptStarted|Delivering'])
  })

  it.each(
    GAP.map((edge) => ({ edge, name: edgeKey(edge) })),
  )('gap edge driven through the runner: $name', ({ edge }) => {
    const route = paths.find((p) => p.target === JSON.stringify(edge.from)) ?? { steps: [] }
    let state: WebhookDeliveryStateName = 'Pending'
    route.steps.forEach((step) => {
      state = applyWebhookDeliveryEvent(state, step.event as never, { clock: fixedClock }).to
    })
    expect(state).toBe(edge.from)
    const fired = applyWebhookDeliveryEvent(state, edge.event as never, { clock: fixedClock })
    expect(fired.changed).toBe(true)
    expect(fired.to).toBe(edge.to)
    gapFill.record(edge)
  })

  it('path edges united with the gap-fill achieve all-transitions: 5/5', () => {
    const union = new Set([...PATH_EDGES, ...gapFill.covered()])
    const report = coverageReport(EDGES, union)
    expect(report.edges_total).toBe(5)
    expect(report.edges_covered).toBe(5)
    expect(report.gap).toEqual([])
  })
})
