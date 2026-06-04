import { expectRFC7807 } from '@qaroom/testing-utils/matchers'
import { describe, expect, it } from 'vitest'
import {
  alwaysDeclines,
  alwaysErrors,
  enableDonations,
  nextKey,
  SAMPLE,
  setupDonationsTest,
} from './harness'

const body = { donor_id: SAMPLE.user, amount_cents: 2500, currency: 'USD' }

const create = (
  ctx: Awaited<ReturnType<typeof setupDonationsTest>>,
  community = SAMPLE.communityA,
) =>
  ctx.request.post(`/api/communities/${community}/donations`, body, {
    'idempotency-key': nextKey(),
  })

describe('donation creation gated by the donations flag', () => {
  it('rejects a donation with 409 when donations are not enabled for the community', async () => {
    const ctx = await setupDonationsTest()
    const res = await create(ctx)
    await ctx.close()
    expectRFC7807(res.json, { status: 409, failureDomain: 'conflict' })
  })

  it('records a Captured donation when enabled and the provider captures', async () => {
    const ctx = await setupDonationsTest()
    await enableDonations(ctx, SAMPLE.communityA)
    const res = await create(ctx)
    await ctx.close()
    expect(res.status).toBe(201)
    expect(res.json).toMatchObject({ status: 'Captured', amount_cents: 2500 })
  })

  it('records a Failed donation when the provider declines (a business outcome, not an error)', async () => {
    const ctx = await setupDonationsTest({ payment: alwaysDeclines() })
    await enableDonations(ctx, SAMPLE.communityA)
    const res = await create(ctx)
    await ctx.close()
    expect(res.status).toBe(201)
    expect(res.json).toMatchObject({ status: 'Failed' })
  })

  it('returns 502 dependency_failure when the payment provider is unreachable', async () => {
    const ctx = await setupDonationsTest({ payment: alwaysErrors() })
    await enableDonations(ctx, SAMPLE.communityA)
    const res = await create(ctx)
    await ctx.close()
    expectRFC7807(res.json, { status: 502, failureDomain: 'dependency_failure' })
  })
})

describe('donation reads', () => {
  it('fetches a created donation and 404s when asked under another community', async () => {
    const ctx = await setupDonationsTest()
    await enableDonations(ctx, SAMPLE.communityA)
    const created = await create(ctx)
    const id = (created.json as { id: string }).id
    const found = await ctx.request.get(`/api/communities/${SAMPLE.communityA}/donations/${id}`)
    const crossTenant = await ctx.request.get(
      `/api/communities/${SAMPLE.communityB}/donations/${id}`,
    )
    await ctx.close()
    expect(found.status).toBe(200)
    expectRFC7807(crossTenant.json, { status: 404, failureDomain: 'not_found' })
  })

  it('lists a community’s donations', async () => {
    const ctx = await setupDonationsTest()
    await enableDonations(ctx, SAMPLE.communityA)
    await create(ctx)
    const res = await ctx.request.get(`/api/communities/${SAMPLE.communityA}/donations`)
    await ctx.close()
    expect((res.json as { donations: unknown[] }).donations).toHaveLength(1)
  })
})
