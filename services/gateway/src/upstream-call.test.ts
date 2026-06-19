import { type MockUpstream, mockUpstream, undiciFetch } from '@qaroom/testing-utils/http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type ClientResponse, upstreamCall, upstreamTimeoutMs } from './upstream-call'

/**
 * The one upstream HTTP primitive. Two things here are security/reliability load-bearing and were
 * untested: (a) the Authorization bearer is forwarded VERBATIM — that is the WS-ticket passthrough
 * the gateway never decodes (ADR-0013/0022) — and (b) `upstreamTimeoutMs` must reject an empty/0/NaN
 * env so a Helm-templated `""` can't collapse the timeout to an instant abort. Outbound calls go
 * through undici's MockAgent (the injected `undiciFetch`); no network, no global fetch stub.
 */
const ORIGIN = 'http://upstream'
const TIMEOUT = 1000

interface Captured {
  headers: Record<string, string>
  method?: string
  body: string | null
}

describe('upstreamCall header construction', () => {
  let up: MockUpstream

  afterEach(async () => {
    await up.restore()
  })

  const interceptCapturing = (method: string, path: string): Captured => {
    const captured: Captured = { headers: {}, body: null }
    up = mockUpstream()
    up.pool(ORIGIN)
      .intercept({ path, method })
      .reply((opts) => {
        captured.headers = opts.headers as Record<string, string>
        captured.method = opts.method
        captured.body = (opts.body as string | null) ?? null
        return { statusCode: 200, data: {} }
      })
    return captured
  }

  it('always sends accept: application/json and omits content-type on a bodyless GET', async () => {
    const cap = interceptCapturing('GET', '/feed')

    await upstreamCall(ORIGIN, { method: 'GET', path: '/feed' }, TIMEOUT, undiciFetch)

    expect(cap.headers.accept).toBe('application/json')
    expect(cap.headers['content-type']).toBeUndefined()
  })

  it('adds content-type: application/json and serializes the body when one is present', async () => {
    const cap = interceptCapturing('POST', '/posts')

    await upstreamCall(
      ORIGIN,
      { method: 'POST', path: '/posts', body: { a: 1 } },
      TIMEOUT,
      undiciFetch,
    )

    expect(cap.headers['content-type']).toBe('application/json')
    expect(JSON.parse(String(cap.body))).toEqual({ a: 1 })
  })

  it('forwards an idempotency-key header when supplied', async () => {
    const cap = interceptCapturing('POST', '/posts')

    await upstreamCall(
      ORIGIN,
      { method: 'POST', path: '/posts', body: { a: 1 }, idempotencyKey: 'idem-9' },
      TIMEOUT,
      undiciFetch,
    )

    expect(cap.headers['idempotency-key']).toBe('idem-9')
  })

  it('forwards the Authorization bearer verbatim (the WS-ticket passthrough the gateway never decodes)', async () => {
    const cap = interceptCapturing('POST', '/ws/tickets')

    await upstreamCall(
      ORIGIN,
      { method: 'POST', path: '/ws/tickets', authorization: 'Bearer header.payload.sig' },
      TIMEOUT,
      undiciFetch,
    )

    expect(cap.headers.authorization).toBe('Bearer header.payload.sig')
  })

  it('omits the Authorization header entirely when no bearer is supplied', async () => {
    const cap = interceptCapturing('GET', '/feed')

    await upstreamCall(ORIGIN, { method: 'GET', path: '/feed' }, TIMEOUT, undiciFetch)

    expect(cap.headers.authorization).toBeUndefined()
  })
})

describe('upstreamCall body parsing', () => {
  let up: MockUpstream

  afterEach(async () => {
    await up.restore()
  })

  const callReplying = (
    status: number,
    data: string | object,
    contentType = 'application/json',
  ): Promise<ClientResponse> => {
    up = mockUpstream()
    up.pool(ORIGIN)
      .intercept({ path: '/r', method: 'GET' })
      .reply(status, data, { headers: { 'content-type': contentType } })
    return upstreamCall(ORIGIN, { method: 'GET', path: '/r' }, TIMEOUT, undiciFetch)
  }

  it('parses a valid-JSON response body into an object, preserving the status', async () => {
    const res = await callReplying(200, { id: 'x' }, 'application/json')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 'x' })
  })

  it('returns a non-JSON 5xx body as raw text instead of throwing (a proxy HTML error page)', async () => {
    const res = await callReplying(502, '<html>502 Bad Gateway</html>', 'text/html')

    expect(res.status).toBe(502)
    expect(res.body).toBe('<html>502 Bad Gateway</html>')
  })

  it('maps an empty response body to undefined', async () => {
    const res = await callReplying(200, '', 'application/json')

    expect(res.body).toBeUndefined()
  })
})

describe('upstreamTimeoutMs env fallback', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each([
    { raw: undefined, label: 'unset' },
    { raw: '', label: 'an empty string (a Helm-templated "")' },
    { raw: '   ', label: 'a blank string' },
    { raw: '0', label: 'a zero (an instant-abort trap)' },
    { raw: 'abc', label: 'a non-numeric value (NaN)' },
    { raw: '-5', label: 'a negative value' },
  ])('falls back to the 5000ms default for $label', ({ raw }) => {
    vi.stubEnv('GATEWAY_UPSTREAM_TIMEOUT_MS', raw)

    expect(upstreamTimeoutMs()).toBe(5000)
  })

  it('honors a valid positive integer', () => {
    vi.stubEnv('GATEWAY_UPSTREAM_TIMEOUT_MS', '8000')

    expect(upstreamTimeoutMs()).toBe(8000)
  })

  it('floors a fractional value to a whole millisecond', () => {
    vi.stubEnv('GATEWAY_UPSTREAM_TIMEOUT_MS', '2500.7')

    expect(upstreamTimeoutMs()).toBe(2500)
  })
})
