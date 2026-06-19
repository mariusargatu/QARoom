import { hangingFetch, mockUpstream, type MockUpstream, undiciFetch } from '@qaroom/testing-utils/http'
import { afterEach, describe, expect, it } from 'vitest'
import { createPaymentClient } from './payment-client'

const BASE = 'http://payment-provider'
const REQ = { amount_cents: 500, currency: 'USD', idempotency_key: 'idem-7' }

describe('createPaymentClient.charge mapping', () => {
  let up: MockUpstream

  afterEach(async () => {
    await up.restore()
  })

  it('maps a 2xx captured response to { provider_ref, status: captured } and shapes the request', async () => {
    up = mockUpstream()
    const captured: Record<string, unknown> = {}
    up.pool(BASE)
      .intercept({ path: '/charges', method: 'POST' })
      .reply((opts) => {
        captured.method = opts.method
        captured.path = opts.path
        captured.headers = opts.headers
        captured.body = opts.body
        return { statusCode: 200, data: { id: 'ch_abc', status: 'captured' } }
      })

    const auth = await createPaymentClient(BASE, undiciFetch).charge(REQ)

    expect(auth).toEqual({ provider_ref: 'ch_abc', status: 'captured' })
    expect(captured.method).toBe('POST')
    expect(captured.path).toBe('/charges')
    expect((captured.headers as Record<string, string>)['idempotency-key']).toBe('idem-7')
    expect(JSON.parse(String(captured.body))).toEqual({ amount_cents: 500, currency: 'USD' })
  })

  it('maps any non-captured provider status to declined', async () => {
    up = mockUpstream()
    up.pool(BASE).intercept({ path: '/charges', method: 'POST' }).reply(200, { id: 'ch_x', status: 'pending' })

    const auth = await createPaymentClient(BASE, undiciFetch).charge(REQ)

    expect(auth.status).toBe('declined')
  })

  it('throws on a non-2xx provider response, carrying the status and body', async () => {
    up = mockUpstream()
    up.pool(BASE).intercept({ path: '/charges', method: 'POST' }).reply(500, 'upstream boom')

    await expect(createPaymentClient(BASE, undiciFetch).charge(REQ)).rejects.toThrow(
      /payment provider returned 500: upstream boom/,
    )
  })

  it('trims a trailing slash from the base URL (the intercept on /charges still matches)', async () => {
    up = mockUpstream()
    up.pool(BASE).intercept({ path: '/charges', method: 'POST' }).reply(200, { id: 'ch_z', status: 'captured' })

    const auth = await createPaymentClient(`${BASE}/`, undiciFetch).charge(REQ)

    expect(auth.provider_ref).toBe('ch_z')
  })
})

describe('createPaymentClient timeout', () => {
  it('aborts a hung charge with a TimeoutError once the bounded timeout elapses', async () => {
    const client = createPaymentClient(BASE, hangingFetch, 0)

    await expect(client.charge({ ...REQ, idempotency_key: 'idem-timeout-1' })).rejects.toMatchObject({
      name: 'TimeoutError',
    })
  })
})
