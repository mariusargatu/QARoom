import { RolloutEventName, rolloutMachine } from '@qaroom/contracts'
import { assertModelMatchesSystem, shortestPaths } from '@qaroom/testing-utils/mbt'
import { describe, expect, it } from 'vitest'
import { nextKey, SAMPLE, setupFlagsTest } from './harness'

/**
 * Model-based testing (Milestone 5, the core demonstration). Every shortest path through the
 * rollout model is replayed against the live flags-service; the service must report exactly
 * the state the model predicts at every step. A deliberately broken transition in the service
 * makes EXACTLY the path(s) through that transition fail, and the failure names the state
 * where the divergence happened — the path IS the trace (exit criterion).
 */
// Drawn from the contract, not hand-listed, so the model/system drift-check cannot itself drift.
const SUPPORTED_EVENTS = RolloutEventName.options

const paths = shortestPaths(rolloutMachine, { maxDepth: 10 })

describe('model-based rollout conformance', () => {
  it('the model matches the system (initial state + every event has an endpoint)', () => {
    assertModelMatchesSystem(rolloutMachine, {
      initialState: 'Off',
      supportedEvents: SUPPORTED_EVENTS,
    })
  })

  it('generates at least one path per reachable state', () => {
    const targets = new Set(paths.map((p) => p.target))
    expect(targets.size).toBe(5)
  })

  it.each(
    paths.map((p) => ({ p, name: p.description })),
  )('system honors model path: $name', async ({ p }) => {
    const ctx = await setupFlagsTest()
    const observed: Array<{ status: number; state: string }> = []
    for (const step of p.steps) {
      const res = await ctx.request.post(
        `/api/communities/${SAMPLE.communityA}/flags/${SAMPLE.flag}/rollout`,
        { event: step.event },
        { 'idempotency-key': nextKey() },
      )
      observed.push({ status: res.status, state: (res.json as { state?: string }).state ?? '' })
    }
    const final = await ctx.request.get(
      `/api/communities/${SAMPLE.communityA}/flags/${SAMPLE.flag}`,
    )
    await ctx.close()

    p.steps.forEach((step, idx) => {
      expect(observed[idx]?.status).toBe(200)
      expect(observed[idx]?.state).toBe(JSON.parse(step.state))
    })
    expect((final.json as { state: string }).state).toBe(JSON.parse(p.target))
  })
})
