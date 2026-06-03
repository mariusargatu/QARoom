import { expectProblemContentType, expectRFC7807 } from '@qaroom/testing-utils/matchers'
import { describe, expect, it } from 'vitest'
import { constantContent, SAMPLE, setupGatewayTest } from './harness'

const okFeed = { status: 200, body: { ok: true }, contentType: 'application/json' }

describe('gateway rate limiting', () => {
  it('returns a 429 rate_limit problem with a Retry-After header once capacity is exceeded', async () => {
    const { request } = setupGatewayTest(constantContent(okFeed), {
      rateLimit: { capacity: 2, refillPerSec: 0 },
    })
    const url = `/api/communities/${SAMPLE.community}/feed`
    const first = await request.get(url)
    const second = await request.get(url)
    const third = await request.get(url)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(third.status).toBe(429)
    expect(third.headers['retry-after']).toBeDefined()
    expectProblemContentType(third.contentType)
    const problem = expectRFC7807(third.json, { status: 429, failureDomain: 'rate_limit' })
    expect(problem.retryable).toBe(true)
  })

  it('reports remaining usage at /system/limits without consuming a token itself', async () => {
    const { request } = setupGatewayTest(constantContent(okFeed), {
      rateLimit: { capacity: 5, refillPerSec: 0 },
    })
    await request.get(`/api/communities/${SAMPLE.community}/feed`)
    const peek1 = await request.get('/system/limits')
    const peek2 = await request.get('/system/limits')

    const body1 = peek1.json as { limit: number; remaining: number }
    const body2 = peek2.json as { remaining: number }
    expect(body1.limit).toBe(5)
    expect(body1.remaining).toBe(4)
    expect(body2.remaining).toBe(4)
  })

  it('reports reset_in_seconds from the bucket deficit, identically on repeated reads (no clock drift)', async () => {
    const { request } = setupGatewayTest(constantContent(okFeed), {
      rateLimit: { capacity: 5, refillPerSec: 1 },
    })
    await request.get(`/api/communities/${SAMPLE.community}/feed`)
    await request.get(`/api/communities/${SAMPLE.community}/feed`)
    const peek1 = await request.get('/system/limits')
    const peek2 = await request.get('/system/limits')

    // deficit = capacity(5) - remaining(3) = 2 tokens; at 1/sec that is 2 seconds.
    expect((peek1.json as { reset_in_seconds: number }).reset_in_seconds).toBe(2)
    // Computed once in the limiter, not re-derived per read — so a second peek is identical.
    expect((peek2.json as { reset_in_seconds: number }).reset_in_seconds).toBe(2)
  })

  it('is not applied to the /system surface', async () => {
    const { request } = setupGatewayTest(constantContent(okFeed), {
      rateLimit: { capacity: 1, refillPerSec: 0 },
    })
    const a = await request.get('/system/limits')
    const b = await request.get('/system/limits')
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
  })
})
