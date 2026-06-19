import { describe, expect, it } from 'vitest'
import { breakerGuardedCall } from './breaker-guarded-call'
import { type CircuitBreaker, CircuitOpenError } from './circuit-breaker'
import type { UpstreamCallOptions } from './upstream-call'

/**
 * `breakerGuardedCall` is the only place the upstream-status → breaker-signal decision table lives,
 * and that table is load-bearing: a 502 (donations cleanly reporting ITS payment provider is down)
 * and a 4xx (a client error) must NOT trip the breaker, or a flaky downstream dependency would
 * fast-fail unrelated reads. These pin the full 3-way table plus the transport-failure and
 * open-circuit short-circuit paths. The injected fetch is the seam (no network).
 */
const BASE = 'http://upstream'
const GET: UpstreamCallOptions = { method: 'GET', path: '/x' }
const TIMEOUT = 1000

/** A fetch double returning a JSON response with the given status — no MockAgent needed here. */
const respondWith = (status: number): typeof fetch =>
  (async () =>
    new Response('{}', {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch

/** A fetch double whose call models a transport failure (connection refused / DNS / reset). */
const throwingFetch: typeof fetch = (async () => {
  throw new Error('ECONNREFUSED')
}) as unknown as typeof fetch

/** A counting fetch so an open-circuit test can prove the upstream was never reached. */
const countingFetch = (status: number) => {
  const state = { calls: 0 }
  const fetchImpl = (async () => {
    state.calls += 1
    return new Response('{}', { status })
  }) as unknown as typeof fetch
  return { fetchImpl, state }
}

/** A breaker double recording each `record(ok)` and answering `allow()` with a fixed verdict. */
const recordingBreaker = (allowed = true) => {
  const recorded: boolean[] = []
  const breaker = {
    allow: () => allowed,
    record: (ok: boolean) => {
      recorded.push(ok)
    },
  } as unknown as CircuitBreaker
  return { breaker, recorded }
}

describe('breakerGuardedCall signal mapping', () => {
  it.each([
    { status: 500, label: 'a 5xx other than 502 (the upstream itself is erroring)' },
    { status: 503, label: 'a 503 service unavailable' },
  ])('records $label as a failure', async ({ status }) => {
    const { breaker, recorded } = recordingBreaker()
    await breakerGuardedCall(breaker, BASE, GET, TIMEOUT, respondWith(status))
    expect(recorded).toEqual([false])
  })

  it.each([
    { status: 200, label: 'a 2xx success' },
    { status: 201, label: 'a 2xx created' },
    { status: 307, label: 'a 3xx redirect' },
  ])('records $label as a success', async ({ status }) => {
    const { breaker, recorded } = recordingBreaker()
    await breakerGuardedCall(breaker, BASE, GET, TIMEOUT, respondWith(status))
    expect(recorded).toEqual([true])
  })

  it.each([
    { status: 502, label: 'a 502 (upstream UP, reporting its own dependency down)' },
    { status: 400, label: 'a 4xx client error' },
    { status: 404, label: 'a 404 not found' },
    { status: 429, label: 'a 429 rate limit' },
  ])('leaves the breaker untouched on $label', async ({ status }) => {
    const { breaker, recorded } = recordingBreaker()
    await breakerGuardedCall(breaker, BASE, GET, TIMEOUT, respondWith(status))
    expect(recorded).toEqual([])
  })
})

describe('breakerGuardedCall transport + open-circuit behavior', () => {
  it('records a transport failure as a breaker failure and rethrows', async () => {
    const { breaker, recorded } = recordingBreaker()

    await expect(breakerGuardedCall(breaker, BASE, GET, TIMEOUT, throwingFetch)).rejects.toThrow(
      'ECONNREFUSED',
    )
    expect(recorded).toEqual([false])
  })

  it('fails fast with CircuitOpenError and never reaches the upstream when the breaker is open', async () => {
    const { breaker, recorded } = recordingBreaker(false)
    const { fetchImpl, state } = countingFetch(200)

    await expect(breakerGuardedCall(breaker, BASE, GET, TIMEOUT, fetchImpl)).rejects.toBeInstanceOf(
      CircuitOpenError,
    )
    expect(state.calls).toBe(0)
    expect(recorded).toEqual([])
  })

  it('returns a delivered non-2xx as data with no breaker (the experiment-06 unguarded path)', async () => {
    const res = await breakerGuardedCall(undefined, BASE, GET, TIMEOUT, respondWith(500))

    expect(res.status).toBe(500)
  })

  it('rethrows a transport failure with no breaker', async () => {
    await expect(breakerGuardedCall(undefined, BASE, GET, TIMEOUT, throwingFetch)).rejects.toThrow(
      'ECONNREFUSED',
    )
  })
})
