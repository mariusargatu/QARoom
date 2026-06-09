import { EXAMPLE_COMMUNITY_ID, EXAMPLE_FLAG_RESOLUTION, makeProblem } from '@qaroom/contracts'
import { UlidIdGenerator } from '@qaroom/determinism'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from './client'
import { ApiError } from './http'

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
    const api = createApiClient('http://gateway', new UlidIdGenerator())
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
    const api = createApiClient('http://gateway', new UlidIdGenerator())
    const flag = await api.resolveFlag(EXAMPLE_COMMUNITY_ID, 'donations')
    expect(flag.state).toBe('Enabled')
  })

  it('throws a typed ApiError carrying the RFC 7807 problem on a non-2xx response', async () => {
    const problem = makeProblem({
      slug: 'dependency-failure',
      title: 'Upstream donations-service unavailable',
      status: 502,
      failure_domain: 'dependency_failure',
      detail: 'The donations-service did not respond.',
      retryable: true,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(problem), {
            status: 502,
            headers: { 'content-type': 'application/problem+json' },
          }),
      ),
    )
    const api = createApiClient('http://gateway', new UlidIdGenerator())
    const err = await api.resolveFlag(EXAMPLE_COMMUNITY_ID, 'donations').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    const apiErr = err as ApiError
    expect(apiErr.status).toBe(502)
    expect(apiErr.failureDomain).toBe('dependency_failure')
    expect(apiErr.retryable).toBe(true)
    expect(apiErr.problem?.title).toBe('Upstream donations-service unavailable')
  })

  it('falls back to a generic ApiError (no problem, not retryable) when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream exploded', { status: 500 })),
    )
    const api = createApiClient('http://gateway', new UlidIdGenerator())
    const err = await api.resolveFlag(EXAMPLE_COMMUNITY_ID, 'donations').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    const apiErr = err as ApiError
    expect(apiErr.status).toBe(500)
    expect(apiErr.problem).toBeUndefined()
    expect(apiErr.retryable).toBe(false)
    expect(apiErr.message).toContain('500')
  })
})
