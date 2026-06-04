import { expectRFC7807 } from '@qaroom/testing-utils/matchers'
import { describe, expect, it } from 'vitest'
import { nextKey, SAMPLE, setupFlagsTest } from './harness'

const advance = (
  ctx: Awaited<ReturnType<typeof setupFlagsTest>>,
  event: string,
  community = SAMPLE.communityA,
) =>
  ctx.request.post(
    `/api/communities/${community}/flags/${SAMPLE.flag}/rollout`,
    { event },
    { 'idempotency-key': nextKey() },
  )

describe('flag resolution and rollout', () => {
  it('resolves an unseen flag as Off and disabled', async () => {
    const ctx = await setupFlagsTest()
    const res = await ctx.request.get(`/api/communities/${SAMPLE.communityA}/flags/${SAMPLE.flag}`)
    await ctx.close()
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ state: 'Off', enabled: false })
  })

  it('advances Off → Enabling on EnableRequested and records the transition', async () => {
    const ctx = await setupFlagsTest()
    const res = await advance(ctx, 'EnableRequested')
    const transitions = [...ctx.transitions]
    await ctx.close()
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ state: 'Enabling', enabled: false })
    expect(transitions).toEqual([
      { from: 'Off', to: 'Enabling', event: 'EnableRequested', at: expect.any(String) },
    ])
  })

  it('drives the full rollout to Enabled, which is the gating-on state', async () => {
    const ctx = await setupFlagsTest()
    await advance(ctx, 'EnableRequested')
    await advance(ctx, 'CanaryConfirmed')
    const res = await advance(ctx, 'RolloutCompleted')
    await ctx.close()
    expect(res.json).toMatchObject({ state: 'Enabled', enabled: true })
  })

  it('rejects an illegal transition with a 409 conflict and leaves state unchanged', async () => {
    const ctx = await setupFlagsTest()
    // RolloutCompleted is illegal from Off.
    const res = await advance(ctx, 'RolloutCompleted')
    const after = await ctx.request.get(
      `/api/communities/${SAMPLE.communityA}/flags/${SAMPLE.flag}`,
    )
    await ctx.close()
    expectRFC7807(res.json, { status: 409, failureDomain: 'conflict' })
    expect(after.json).toMatchObject({ state: 'Off' })
  })

  it('lists every flag resolved for a community', async () => {
    const ctx = await setupFlagsTest()
    await advance(ctx, 'EnableRequested')
    const res = await ctx.request.get(`/api/communities/${SAMPLE.communityA}/flags`)
    await ctx.close()
    expect(res.status).toBe(200)
    expect((res.json as { flags: unknown[] }).flags).toHaveLength(1)
  })
})
