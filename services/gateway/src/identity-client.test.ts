import { type MockUpstream, mockUpstream, undiciFetch } from '@qaroom/testing-utils/http'
import { afterEach, describe, expect, it } from 'vitest'
import { createIdentityClient } from './identity-client'

/**
 * The gateway→identity client is verified end-to-end by its Pact consumer test; this pins the one
 * mapper the Pact does not cover — `createWsTicket` (ADR-0013). It POSTs to `/ws/tickets`, forwards
 * the caller's `Authorization` header verbatim (the gateway never decodes the JWT — identity
 * verifies it against its own JWKS), and deliberately sends NO Idempotency-Key (each call mints a
 * fresh one-use ticket). Outbound calls go through undici's MockAgent via the injected `undiciFetch`.
 */
const BASE_URL = 'http://identity'

describe('createIdentityClient.createWsTicket', () => {
  let up: MockUpstream

  afterEach(async () => {
    await up.restore()
  })

  it('POSTs to /ws/tickets forwarding the Authorization header and no Idempotency-Key', async () => {
    const captured: { method?: string; path?: string; auth?: unknown; idem?: unknown } = {}
    up = mockUpstream()
    up.pool(BASE_URL)
      .intercept({ path: '/ws/tickets', method: 'POST' })
      .reply((opts) => {
        captured.method = opts.method
        captured.path = opts.path
        captured.auth = opts.headers && (opts.headers as Record<string, string>).authorization
        captured.idem = opts.headers && (opts.headers as Record<string, string>)['idempotency-key']
        return { statusCode: 201, data: { ticket: 'tkt_x' } }
      })

    const res = await createIdentityClient(BASE_URL, { fetchImpl: undiciFetch }).createWsTicket(
      'Bearer t.jwt',
    )

    expect(captured.method).toBe('POST')
    expect(captured.path).toBe('/ws/tickets')
    expect(captured.auth).toBe('Bearer t.jwt')
    expect(captured.idem).toBeUndefined()
    expect(res.body).toEqual({ ticket: 'tkt_x' })
  })
})
