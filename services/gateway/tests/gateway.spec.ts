import {
  expectCapabilitiesCover,
  expectLamportAdvanced,
  expectProblemContentType,
  expectRFC7807,
  lamportOf,
} from '@qaroom/testing-utils/matchers'
import { describe, expect, it } from 'vitest'
import { OPERATIONS } from '../src/operations'
import { constantContent, SAMPLE, setupGatewayTest, unreachableContent } from './harness'

const createdPost = {
  id: SAMPLE.post,
  community_id: SAMPLE.community,
  author_id: SAMPLE.user,
  title: 'a gateway post',
  body: 'b',
  score: 0,
  created_at: '2026-01-01T00:00:00.000Z',
}

const postBody = { author_id: SAMPLE.user, title: 'a gateway post', body: 'b' }

describe('gateway proxy behaviour', () => {
  it('proxies the upstream 201 and body through unchanged on create', async () => {
    const { request } = setupGatewayTest(
      constantContent({ status: 201, body: createdPost, contentType: 'application/json' }),
    )
    const res = await request.post(`/api/communities/${SAMPLE.community}/posts`, postBody, {
      'idempotency-key': 'k1',
    })
    expect(res.status).toBe(201)
    expect(res.json).toEqual(createdPost)
  })

  it('advances the gateway lamport on a successful proxied mutation', async () => {
    const { request } = setupGatewayTest(
      constantContent({ status: 201, body: createdPost, contentType: 'application/json' }),
    )
    const before = lamportOf((await request.get('/system/state')).json)
    await request.post(`/api/communities/${SAMPLE.community}/posts`, postBody, {
      'idempotency-key': 'k2',
    })
    const after = lamportOf((await request.get('/system/state')).json)
    expectLamportAdvanced(before, after)
  })

  it('rejects a malformed community id at the edge with a 400 and never calls the upstream', async () => {
    const { request } = setupGatewayTest(unreachableContent())
    const res = await request.post('/api/communities/not-a-community/posts', postBody, {
      'idempotency-key': 'k3',
    })
    expectRFC7807(res.json, { status: 400, failureDomain: 'validation' })
  })

  it('rejects a mutation that omits the Idempotency-Key with a 400', async () => {
    const { request } = setupGatewayTest(
      constantContent({ status: 201, body: createdPost, contentType: 'application/json' }),
    )
    const res = await request.post(`/api/communities/${SAMPLE.community}/posts`, postBody)
    expectRFC7807(res.json, { status: 400, failureDomain: 'validation' })
  })

  it('surfaces an unreachable upstream as a 502 dependency_failure problem', async () => {
    const { request } = setupGatewayTest(unreachableContent())
    const res = await request.get(`/api/communities/${SAMPLE.community}/feed`)
    expectProblemContentType(res.contentType)
    const problem = expectRFC7807(res.json, { status: 502, failureDomain: 'dependency_failure' })
    expect(problem.retryable).toBe(true)
  })

  it('passes an upstream 404 problem through unchanged', async () => {
    const upstreamProblem = {
      type: 'https://qaroom.dev/errors/post-not-found',
      title: 'Post not found',
      status: 404,
      retryable: false,
      next_actions: [],
      failure_domain: 'not_found',
    }
    const { request } = setupGatewayTest(
      constantContent({
        status: 404,
        body: upstreamProblem,
        contentType: 'application/problem+json',
      }),
    )
    const res = await request.get(`/api/posts/${SAMPLE.post}`)
    expect(res.status).toBe(404)
    expectProblemContentType(res.contentType)
    expectRFC7807(res.json, { status: 404, failureDomain: 'not_found' })
  })

  it('lists every gateway operation in /system/capabilities', async () => {
    const { request } = setupGatewayTest(
      constantContent({ status: 200, body: {}, contentType: 'application/json' }),
    )
    expectCapabilitiesCover((await request.get('/system/capabilities')).json, OPERATIONS)
  })
})
