import { describe, expect, it } from 'vitest'
import { SAMPLE, setupContentTest } from './harness'

/**
 * Boundary 16 — agentic development as a tested boundary (ADR-0032), the `gate-survives-agent-gaming`
 * claim. Threat model: an agent patches a bug INTO the product (here the tenancy leak,
 * `AGENT_PATCH_AROUND_GATE`, which loosens listFeed's per-community WHERE) and papers over it with a
 * weak-oracle "test" that stays green. The experiment's point: a strong INVARIANT gate cannot be
 * gamed that way — it still reds on the real bug while the green-theater test sails through.
 *
 * The two tests are the demonstration. The first is the green theater an agent would add: it only
 * checks the post APPEARS, which is true with or without the leak. The second is the invariant gate:
 * it reds under the toggle (`pnpm prove gate-survives-agent-gaming --break`) no matter how green the
 * theater is. No branch on the toggle here — faults are armed from env at app construction (the SUT).
 */
describe('agentic boundary: a strong invariant gate survives agent gaming', () => {
  it('GREEN THEATER (weak oracle): a created post appears in its own community feed', async () => {
    const ctx = await setupContentTest()
    const res = await ctx.request.post(
      `/api/communities/${SAMPLE.communityA}/posts`,
      { author_id: SAMPLE.user, title: 'post-in-A', body: 'b' },
      { 'idempotency-key': 'gaming-theater' },
    )
    expect(res.status).toBe(201)
    const feed = await ctx.request.get(`/api/communities/${SAMPLE.communityA}/feed`)
    const titles = (feed.json as { posts: { title: string }[] }).posts.map((p) => p.title)
    // A weak membership oracle: passes whether or not another tenant's posts leaked in.
    expect(titles).toContain('post-in-A')
    await ctx.close()
  })

  it('a community feed contains only its own posts, even when an agent games the gate', async () => {
    const ctx = await setupContentTest()
    await ctx.request.post(
      `/api/communities/${SAMPLE.communityA}/posts`,
      { author_id: SAMPLE.user, title: 'post-in-A', body: 'b' },
      { 'idempotency-key': 'gaming-a' },
    )
    await ctx.request.post(
      `/api/communities/${SAMPLE.communityB}/posts`,
      { author_id: SAMPLE.user, title: 'post-in-B', body: 'b' },
      { 'idempotency-key': 'gaming-b' },
    )
    const feed = await ctx.request.get(`/api/communities/${SAMPLE.communityA}/feed`)
    const titles = (feed.json as { posts: { title: string }[] }).posts.map((p) => p.title)
    // The strong invariant: community A's feed is EXACTLY its own post. The leak the agent patched in
    // (AGENT_PATCH_AROUND_GATE) makes B's post appear here, and this assertion reds on it.
    expect(titles).toEqual(['post-in-A'])
    await ctx.close()
  })
})
