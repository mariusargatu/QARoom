import { afterEach, describe, expect, it, vi } from 'vitest'
import { GatewayClient } from './client'

/**
 * Unit tests for the shared live-cluster client. They cover the call-site conventions the client
 * enforces — deterministic Idempotency-Key derivation, caller-pinned replay keys, bearer-token
 * attachment, and transport-failure containment — by stubbing `fetch`, so they run with no cluster.
 */
const CONFIG = {
  baseUrl: 'http://gateway',
  requestBudgetMs: 1_000,
  idempotencySeed: 'seed',
} as const

function ok(status: number, body: unknown): { status: number; text: () => Promise<string> } {
  return { status, text: async () => JSON.stringify(body) }
}

function headersOf(mock: ReturnType<typeof vi.fn>, call: number): Headers {
  return (mock.mock.calls[call]?.[1] as { headers: Headers }).headers
}

describe('GatewayClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('derives a deterministic Idempotency-Key from the seed on the first mutating call', async () => {
    const fetchMock = vi.fn(async () => ok(201, { id: 'x' }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new GatewayClient(CONFIG)

    await client.post('/api/things', { a: 1 })

    expect(headersOf(fetchMock, 0).get('idempotency-key')).toBe('seed-000000')
  })

  it('increments the Idempotency-Key counter monotonically across mutating calls', async () => {
    const fetchMock = vi.fn(async () => ok(201, {}))
    vi.stubGlobal('fetch', fetchMock)
    const client = new GatewayClient(CONFIG)

    await client.post('/a', {})
    await client.post('/b', {})

    expect(headersOf(fetchMock, 1).get('idempotency-key')).toBe('seed-000001')
  })

  it('honors a caller-pinned Idempotency-Key (replay) instead of generating one', async () => {
    const fetchMock = vi.fn(async () => ok(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    const client = new GatewayClient(CONFIG)

    await client.post('/a', {}, { idempotencyKey: 'pinned-key' })

    expect(headersOf(fetchMock, 0).get('idempotency-key')).toBe('pinned-key')
  })

  it('attaches the bearer token when a session token is supplied', async () => {
    const fetchMock = vi.fn(async () => ok(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    const client = new GatewayClient(CONFIG)

    await client.get('/me', { token: 'jwt-abc' })

    expect(headersOf(fetchMock, 0).get('authorization')).toBe('Bearer jwt-abc')
  })

  it('omits the Idempotency-Key header on a GET (non-mutating)', async () => {
    const fetchMock = vi.fn(async () => ok(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    const client = new GatewayClient(CONFIG)

    await client.get('/feed')

    expect(headersOf(fetchMock, 0).get('idempotency-key')).toBeNull()
  })

  it('surfaces a transport failure as a sentinel status-0 response rather than throwing', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new GatewayClient(CONFIG)

    const res = await client.get('/down')

    expect(res.status).toBe(0)
  })

  it('records the transport error detail in the sentinel response body', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new GatewayClient(CONFIG)

    const res = await client.get('/down')

    expect(res.body).toEqual({ transport_error: 'ECONNREFUSED' })
  })

  it('parses a JSON response body', async () => {
    const fetchMock = vi.fn(async () => ok(200, { hello: 'world' }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new GatewayClient(CONFIG)

    const res = await client.get('/thing')

    expect(res.body).toEqual({ hello: 'world' })
  })
})
