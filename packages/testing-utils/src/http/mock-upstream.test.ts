import { afterEach, describe, expect, it } from 'vitest'
import { hangingFetch, type MockUpstream, mockUpstream, undiciFetch } from './mock-upstream'

describe('mockUpstream', () => {
  // Restore in afterEach (not inline) so a rejecting fetch can't skip it and leak the net-disabled
  // global dispatcher into later tests — the contract the helper's own docstring states.
  let up: MockUpstream
  afterEach(async () => {
    await up.restore()
  })

  it('intercepts the injected undici fetch and returns the mocked JSON response', async () => {
    up = mockUpstream()
    up.pool('http://identity').intercept({ path: '/jwks.json' }).reply(200, { keys: [] })

    const res = await undiciFetch('http://identity/jwks.json')
    const body = (await res.json()) as { keys: unknown[] }

    expect(res.status).toBe(200)
    expect(body).toEqual({ keys: [] })
  })

  it('models an upstream error reply (5xx) with a raw text body', async () => {
    up = mockUpstream()
    up.pool('http://content').intercept({ path: '/api/x', method: 'GET' }).reply(503, 'overloaded')

    const res = await undiciFetch('http://content/api/x')
    const text = await res.text()

    expect(res.status).toBe(503)
    expect(text).toBe('overloaded')
  })
})

describe('hangingFetch', () => {
  it('rejects with the abort reason when the signal fires, never otherwise', async () => {
    const controller = new AbortController()
    const reason = new Error('timed out')
    const pending = hangingFetch('http://x', { signal: controller.signal })
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
  })
})
