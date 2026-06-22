import { describe, expect, it } from 'vitest'
import { nextKey, SAMPLE, setupFlagsTest } from './harness'

/**
 * `GET /system/state` (Commitment 7) for flags-service. The cross-cutting shell comes from
 * service-kit, but the flags `models` provider is wired in `app.ts` and projects the live flag
 * count from the DB — exercised here so the projection is observed end-to-end via app.inject,
 * not just asserted on the repository helper in isolation.
 */
describe('flags /system/state model projection', () => {
  it('names the service and reports a zero flag count on an empty store', async () => {
    const ctx = await setupFlagsTest()
    const res = await ctx.request.get('/system/state')
    await ctx.close()
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ service: 'flags', models: { flags: { count: 0 } } })
  })

  it('reflects the count of flags that have advanced at least once', async () => {
    const ctx = await setupFlagsTest()
    await ctx.request.post(
      `/api/communities/${SAMPLE.communityA}/flags/${SAMPLE.flag}/rollout`,
      { event: 'EnableRequested' },
      { 'idempotency-key': nextKey() },
    )
    const res = await ctx.request.get('/system/state')
    await ctx.close()
    expect(res.json).toMatchObject({ service: 'flags', models: { flags: { count: 1 } } })
  })
})
