import {
  expectCapabilitiesCover,
  expectLamportAdvanced,
  expectLamportStable,
  expectProblemContentType,
  expectRFC7807,
  lamportOf,
} from '@qaroom/testing-utils/matchers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OPERATIONS } from '../src/operations'
import { SAMPLE, setupContentTest } from './harness'

type Ctx = Awaited<ReturnType<typeof setupContentTest>>

describe('content-service HTTP behaviour', () => {
  let ctx: Ctx

  beforeEach(async () => {
    ctx = await setupContentTest()
  })

  afterEach(async () => {
    await ctx.close()
  })

  const createSample = (key: string) =>
    ctx.request.post(
      `/api/communities/${SAMPLE.communityA}/posts`,
      { author_id: SAMPLE.user, title: 'a deterministic post', body: 'body' },
      { 'idempotency-key': key },
    )

  it('creating a post returns 201 with a zero initial score scoped to the community', async () => {
    const created = await createSample('k1')
    const post = created.json as { score: number; community_id: string; id: string }
    expect(created.status).toBe(201)
    expect(post.score).toBe(0)
    expect(post.community_id).toBe(SAMPLE.communityA)
  })

  it('replaying a mutation with the same Idempotency-Key returns the original response, creates no second post, and does not advance the lamport counter', async () => {
    const first = await createSample('dup')
    const afterFirst = lamportOf((await ctx.request.get('/system/state')).json)
    const replay = await createSample('dup')
    const state = await ctx.request.get('/system/state')
    const body = state.json as { as_of: { lamport: number }; models: { posts: { count: number } } }
    expect(replay.json).toEqual(first.json)
    expect(body.models.posts.count).toBe(1)
    // A replay is served from the idempotency store — no tracked write, so the gate is stable.
    expectLamportStable(afterFirst, body.as_of.lamport)
  })

  it('fetching a non-existent post returns a 404 problem+json in the not_found domain', async () => {
    const res = await ctx.request.get('/api/posts/post_01HZY0K7M3QF8VN2J5RX9TB4ZZ')
    expectProblemContentType(res.contentType)
    expectRFC7807(res.json, { status: 404, failureDomain: 'not_found' })
  })

  it('casting a vote raises the score to 1 and advances the lamport counter', async () => {
    const created = await createSample('k2')
    const postId = (created.json as { id: string }).id
    const before = lamportOf((await ctx.request.get('/system/state')).json)
    const voted = await ctx.request.post(
      `/api/posts/${postId}/votes`,
      { voter_id: SAMPLE.user, value: 1 },
      { 'idempotency-key': 'v1' },
    )
    const after = lamportOf((await ctx.request.get('/system/state')).json)
    expect((voted.json as { score: number }).score).toBe(1)
    expectLamportAdvanced(before, after)
  })

  it('a created post appears in its community feed inside an as_of envelope', async () => {
    await createSample('k3')
    const feed = await ctx.request.get(`/api/communities/${SAMPLE.communityA}/feed`)
    const body = feed.json as { posts: unknown[]; as_of: { lamport: number; snapshot_id: string } }
    expect(body.posts.length).toBe(1)
    expect(typeof body.as_of.snapshot_id).toBe('string')
  })

  it('system capabilities lists every operation in the registry (no operation is silently omitted)', async () => {
    expectCapabilitiesCover((await ctx.request.get('/system/capabilities')).json, OPERATIONS)
  })

  it('every capability is MCP-tool-shaped with an object input_schema', async () => {
    const res = await ctx.request.get('/system/capabilities')
    const shapes = (
      res.json as { capabilities: { input_schema: { type: string } }[] }
    ).capabilities.map((c) => c.input_schema.type)
    expect(shapes.every((t) => t === 'object')).toBe(true)
  })

  it('a mutation without an Idempotency-Key is rejected as a 400 validation problem', async () => {
    const res = await ctx.request.post(`/api/communities/${SAMPLE.communityA}/posts`, {
      author_id: SAMPLE.user,
      title: 'no key',
      body: 'b',
    })
    expectRFC7807(res.json, { status: 400, failureDomain: 'validation' })
  })
})
