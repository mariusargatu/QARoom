import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { SAMPLE, setupContentTest } from './harness'

/**
 * Feed ROUTE default window — the missing oracle behind `routes/feed.ts`. The route calls
 * `listFeed(deps.db, deps, communityId)` with NO explicit limit, relying on the repository's
 * default-50 window. Every HTTP feed test seeds <=3 posts, so a route that quietly passed a small
 * explicit limit (e.g. `listFeed(..., 10)`) would still pass them all. This seeds 60 posts and
 * pins the full default window (50), newest-first, end-to-end through the GET handler.
 */
describe('community feed route default window', () => {
  it('returns the full default-50 window newest-first when more than 50 posts exist', async () => {
    const ctx = await setupContentTest()
    // 60 posts at strictly increasing instants; p60 is newest, p11 is the 50th-newest.
    await ctx.db.execute(sql`
      INSERT INTO posts (id, community_id, author_id, title, body, score, created_at)
      SELECT 'post_' || lpad(g::text, 26, '0'), ${SAMPLE.communityA}, ${SAMPLE.user}, 'p' || g, 'b', 0,
        timestamptz '2026-06-04T00:00:00.000Z' + (g * interval '1 second')
      FROM generate_series(1, 60) AS g`)

    const feed = await ctx.request.get(`/api/communities/${SAMPLE.communityA}/feed`)
    const titles = (feed.json as { posts: { title: string }[] }).posts.map((p) => p.title)

    expect(feed.status).toBe(200)
    // The whole default window comes back — not a smaller truncated slice.
    expect(titles.length).toBe(50)
    // Newest-first: the freshest post leads and the 50th-newest closes the window.
    expect(titles[0]).toBe('p60')
    expect(titles[49]).toBe('p11')
    await ctx.close()
  })
})
