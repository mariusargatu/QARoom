import { expectProblemContentType, expectRFC7807 } from '@qaroom/testing-utils/matchers'
import { describe, expect, it } from 'vitest'
import { nextKey, SAMPLE, setupWebhooksTest } from './harness'

const BASE = (community: string = SAMPLE.communityA) =>
  `/api/communities/${community}/webhook-subscriptions`

const validBody = { url: 'https://hooks.example.com/qaroom', event_types: ['post.created'] }

const create = (
  ctx: Awaited<ReturnType<typeof setupWebhooksTest>>,
  body: unknown = validBody,
  community = SAMPLE.communityA,
) => ctx.request.post(BASE(community), body, { 'idempotency-key': nextKey() })

describe('webhook subscription CRUD', () => {
  it('creates a subscription and returns the write-once secret', async () => {
    const ctx = await setupWebhooksTest()
    const res = await create(ctx)
    await ctx.close()
    expect(res.status).toBe(201)
    expect(res.json).toMatchObject({ status: 'Active', url: validBody.url })
    expect((res.json as { secret: string }).secret).toMatch(/^whsec_/)
  })

  it('never returns the secret on reads', async () => {
    const ctx = await setupWebhooksTest()
    const created = await create(ctx)
    const id = (created.json as { id: string }).id
    const got = await ctx.request.get(`${BASE()}/${id}`)
    await ctx.close()
    expect(got.status).toBe(200)
    expect((got.json as Record<string, unknown>).secret).toBeUndefined()
  })

  it('lists a community’s subscriptions', async () => {
    const ctx = await setupWebhooksTest()
    await create(ctx)
    const res = await ctx.request.get(BASE())
    await ctx.close()
    expect(res.status).toBe(200)
    expect((res.json as { webhooks: unknown[] }).webhooks).toHaveLength(1)
  })

  it('404s a subscription requested from a different community (tenant-scoped)', async () => {
    const ctx = await setupWebhooksTest()
    const created = await create(ctx)
    const id = (created.json as { id: string }).id
    const res = await ctx.request.get(`${BASE(SAMPLE.communityB)}/${id}`)
    await ctx.close()
    expectRFC7807(res.json, { status: 404, failureDomain: 'not_found' })
  })

  it('lists deliveries for a subscription (empty before any event)', async () => {
    const ctx = await setupWebhooksTest()
    const created = await create(ctx)
    const id = (created.json as { id: string }).id
    const res = await ctx.request.get(`${BASE()}/${id}/deliveries`)
    await ctx.close()
    expect(res.status).toBe(200)
    expect((res.json as { deliveries: unknown[] }).deliveries).toEqual([])
  })

  it('deletes a subscription, after which it 404s', async () => {
    const ctx = await setupWebhooksTest()
    const created = await create(ctx)
    const id = (created.json as { id: string }).id
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `${BASE()}/${id}`,
      headers: { 'idempotency-key': nextKey() },
    })
    const got = await ctx.request.get(`${BASE()}/${id}`)
    await ctx.close()
    expect(del.statusCode).toBe(204)
    expect(got.status).toBe(404)
  })

  it('replays the cached 204 for a repeated delete with the same Idempotency-Key', async () => {
    const ctx = await setupWebhooksTest()
    const created = await create(ctx)
    const id = (created.json as { id: string }).id
    const key = nextKey()
    const first = await ctx.app.inject({
      method: 'DELETE',
      url: `${BASE()}/${id}`,
      headers: { 'idempotency-key': key },
    })
    const replay = await ctx.app.inject({
      method: 'DELETE',
      url: `${BASE()}/${id}`,
      headers: { 'idempotency-key': key },
    })
    await ctx.close()
    expect(first.statusCode).toBe(204)
    // Without idempotent replay the second call would 404 (row already gone); the convention caches it.
    expect(replay.statusCode).toBe(204)
  })
})

describe('webhook subscription RFC 7807 conformance', () => {
  it('rejects an SSRF target url with 422 validation', async () => {
    const ctx = await setupWebhooksTest()
    const res = await create(ctx, {
      url: 'https://169.254.169.254/latest',
      event_types: ['post.created'],
    })
    await ctx.close()
    expectProblemContentType(res.contentType)
    expectRFC7807(res.json, { status: 422, failureDomain: 'validation' })
  })

  it('rejects a missing Idempotency-Key with 400 validation', async () => {
    const ctx = await setupWebhooksTest()
    const res = await ctx.request.post(BASE(), validBody)
    await ctx.close()
    expectRFC7807(res.json, { status: 400, failureDomain: 'validation' })
  })

  it('rejects an empty event_types list with 400 validation', async () => {
    const ctx = await setupWebhooksTest()
    const res = await create(ctx, { url: validBody.url, event_types: [] })
    await ctx.close()
    expectRFC7807(res.json, { status: 400, failureDomain: 'validation' })
  })
})

describe('webhook subscription pause/resume', () => {
  it('pauses an Active subscription then resumes it', async () => {
    const ctx = await setupWebhooksTest()
    const created = await create(ctx)
    const id = (created.json as { id: string }).id
    const paused = await ctx.request.post(
      `${BASE()}/${id}/pause`,
      {},
      { 'idempotency-key': nextKey() },
    )
    const resumed = await ctx.request.post(
      `${BASE()}/${id}/resume`,
      {},
      { 'idempotency-key': nextKey() },
    )
    await ctx.close()
    expect((paused.json as { status: string }).status).toBe('Paused')
    expect((resumed.json as { status: string }).status).toBe('Active')
  })

  it('rejects pausing an already-paused subscription with 409 conflict', async () => {
    const ctx = await setupWebhooksTest()
    const created = await create(ctx)
    const id = (created.json as { id: string }).id
    await ctx.request.post(`${BASE()}/${id}/pause`, {}, { 'idempotency-key': nextKey() })
    const again = await ctx.request.post(
      `${BASE()}/${id}/pause`,
      {},
      { 'idempotency-key': nextKey() },
    )
    await ctx.close()
    expectRFC7807(again.json, { status: 409, failureDomain: 'conflict' })
  })
})
