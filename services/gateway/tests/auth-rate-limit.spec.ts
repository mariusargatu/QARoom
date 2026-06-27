import { EXAMPLE_USER_ID } from '@qaroom/contracts'
import { expectProblemContentType, expectRFC7807 } from '@qaroom/testing-utils/matchers'
import { describe, expect, it } from 'vitest'
import { constantContent, constantIdentity, SAMPLE, setupGatewayTest } from './harness'

/**
 * The credential endpoint (`POST /api/sessions`) carries a dedicated brute-force bucket separate
 * from the general per-principal limiter (OWASP API#2, broken authentication). These tests pin the
 * SEVERITY requirement: the auth bucket must trip independently — credential attempts get throttled
 * on their own tight budget while ordinary traffic, riding the generous general bucket, flows.
 */
const okFeed = { status: 200, body: { ok: true }, contentType: 'application/json' } as const
const created = { status: 201, body: { ok: true }, contentType: 'application/json' } as const
const sessionBody = { user_id: EXAMPLE_USER_ID }

describe('auth brute-force bucket (POST /api/sessions)', () => {
  it('throttles rapid session attempts on the auth bucket while the general limiter still has capacity', async () => {
    const { request } = setupGatewayTest(constantContent(okFeed), {
      identity: constantIdentity(created),
      // General: plenty of room. Auth: trips after two attempts.
      rateLimit: { capacity: 50, refillPerSec: 0 },
      authRateLimit: { capacity: 2, refillPerSec: 0 },
    })

    const first = await request.post('/api/sessions', sessionBody, { 'idempotency-key': 'a1' })
    const second = await request.post('/api/sessions', sessionBody, { 'idempotency-key': 'a2' })
    const third = await request.post('/api/sessions', sessionBody, { 'idempotency-key': 'a3' })
    // The general bucket is untouched by the auth trip — ordinary traffic still flows.
    const feed = await request.get(`/api/communities/${SAMPLE.community}/feed`)

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(third.status).toBe(429)
    expect(feed.status).toBe(200)
  })

  it('returns an RFC 7807 rate_limit problem attributable to the AUTH bucket (distinct type)', async () => {
    const { request } = setupGatewayTest(constantContent(okFeed), {
      identity: constantIdentity(created),
      rateLimit: { capacity: 50, refillPerSec: 0 },
      authRateLimit: { capacity: 1, refillPerSec: 0 },
    })

    await request.post('/api/sessions', sessionBody, { 'idempotency-key': 'b1' })
    const blocked = await request.post('/api/sessions', sessionBody, { 'idempotency-key': 'b2' })

    expect(blocked.status).toBe(429)
    expect(blocked.headers['retry-after']).toBeDefined()
    expectProblemContentType(blocked.contentType)
    const problem = expectRFC7807(blocked.json, { status: 429, failureDomain: 'rate_limit' })
    expect(problem.retryable).toBe(true)
    // Distinct from the general limiter's `rate-limited` type — proves the AUTH bucket tripped.
    expect(problem.type).toContain('auth-rate-limited')
  })

  it('does not throttle non-credential traffic on the auth bucket (auth bucket scoped to /api/sessions)', async () => {
    // Auth bucket would trip after a single attempt — but it must NEVER apply to a plain feed read.
    const { request } = setupGatewayTest(constantContent(okFeed), {
      rateLimit: { capacity: 50, refillPerSec: 0 },
      authRateLimit: { capacity: 1, refillPerSec: 0 },
    })

    const url = `/api/communities/${SAMPLE.community}/feed`
    const first = await request.get(url)
    const second = await request.get(url)
    const third = await request.get(url)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(third.status).toBe(200)
  })
})
