import {
  hangingFetch,
  type MockUpstream,
  mockUpstream,
  undiciFetch,
} from '@qaroom/testing-utils/http'
import { afterEach, describe, expect, it } from 'vitest'
import { createJwksClient } from './jwks-client'

/**
 * The JWKS seam is the Pact consumer for identity issuance (happy path pinned by the Pact spec).
 * These pin what the bounded-timeout seam adds: the URL/method the client builds, a tolerant
 * non-JSON parse (a proxy 5xx HTML page must not be misclassified as a transport failure), and the
 * fast-fail when the timeout elapses. Outbound calls go through undici's MockAgent via the injected
 * `undiciFetch` (Node's global fetch ignores a test dispatcher — DI is the only interceptable seam).
 */
const BASE_URL = 'http://identity'

describe('createJwksClient.getJwks', () => {
  let up: MockUpstream

  afterEach(async () => {
    await up.restore()
  })

  it('issues a GET to /jwks.json and returns the parsed JWKS body', async () => {
    const captured: { method?: string; path?: string } = {}
    up = mockUpstream()
    up.pool(BASE_URL)
      .intercept({ path: '/jwks.json', method: 'GET' })
      .reply((opts) => {
        captured.method = opts.method
        captured.path = opts.path
        return { statusCode: 200, data: { keys: [] } }
      })

    const res = await createJwksClient(BASE_URL, { fetchImpl: undiciFetch }).getJwks()

    expect(captured.method).toBe('GET')
    expect(captured.path).toBe('/jwks.json')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ keys: [] })
  })

  it('returns a non-JSON 5xx body as raw text instead of throwing', async () => {
    up = mockUpstream()
    up.pool(BASE_URL)
      .intercept({ path: '/jwks.json', method: 'GET' })
      .reply(502, '<html>502 Bad Gateway</html>', { headers: { 'content-type': 'text/html' } })

    const res = await createJwksClient(BASE_URL, { fetchImpl: undiciFetch }).getJwks()

    expect(res.status).toBe(502)
    expect(res.body).toBe('<html>502 Bad Gateway</html>')
  })
})

describe('createJwksClient timeout seam', () => {
  it('fast-fails with a TimeoutError when the bounded timeout elapses (a partitioned identity)', async () => {
    const client = createJwksClient(BASE_URL, { timeoutMs: 0, fetchImpl: hangingFetch })

    await expect(client.getJwks()).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})
