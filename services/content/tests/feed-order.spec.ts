import { describe, expect, it } from 'vitest'
import { SAMPLE, setupContentTest } from './harness'

/**
 * Feed ORDERING — the hole the detection matrix found (2026-06-10): every existing test asserted
 * a post APPEARS in the feed, none asserted WHERE. A reversed feed (CONTENT_BUG_FEED_REVERSED)
 * passed the entire in-proc battery. This spec pins newest-first explicitly: three posts created
 * at distinct seeded-clock instants must come back in strict reverse creation order.
 */
describe('community feed ordering', () => {
  it('returns posts newest-first by creation time', async () => {
    const ctx = await setupContentTest()
    const titles = ['oldest', 'middle', 'newest']
    for (const [i, title] of titles.entries()) {
      const res = await ctx.request.post(
        `/api/communities/${SAMPLE.communityA}/posts`,
        { author_id: SAMPLE.user, title, body: 'b' },
        { 'idempotency-key': `feed-order-${i}` },
      )
      expect(res.status).toBe(201)
      ctx.clock.advance(1_000)
    }

    const feed = await ctx.request.get(`/api/communities/${SAMPLE.communityA}/feed`)
    const got = (feed.json as { posts: { title: string }[] }).posts.map((p) => p.title)
    expect(got).toEqual(['newest', 'middle', 'oldest'])
    await ctx.close()
  })
})
