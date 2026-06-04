import { EXAMPLE_COMMUNITY_ID, EXAMPLE_FLAG_RESOLUTION } from '@qaroom/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from './client'

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the gateway api client', () => {
  it('sends a distinct Idempotency-Key on each mutating call', async () => {
    const keys: Array<string | undefined> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>
        keys.push(headers['idempotency-key'])
        return okJson(EXAMPLE_FLAG_RESOLUTION)
      }),
    )
    const api = createApiClient('http://gateway')
    await api.advanceRollout(EXAMPLE_COMMUNITY_ID, 'donations', 'EnableRequested')
    await api.advanceRollout(EXAMPLE_COMMUNITY_ID, 'donations', 'CanaryConfirmed')
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })

  it('parses a flag resolution from the gateway response through the contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okJson(EXAMPLE_FLAG_RESOLUTION)),
    )
    const api = createApiClient('http://gateway')
    const flag = await api.resolveFlag(EXAMPLE_COMMUNITY_ID, 'donations')
    expect(flag.state).toBe('Enabled')
  })
})
