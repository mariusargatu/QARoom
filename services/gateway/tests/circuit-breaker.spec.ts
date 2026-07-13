import { createServer, type Server } from 'node:http'
import { FakeClock, SeededRandomness } from '@qaroom/testing-utils/determinism'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDonationsClient } from '../src/clients/donations-client'
import { CircuitBreaker } from '../src/resilience/circuit-breaker'
import { constantContent, SAMPLE, setupGatewayTest } from './harness'

/**
 * Experiment-06 property, proven in-process (the live Litmus HTTP-500 injection is nightly —
 * Chaos Mesh HTTPChaos is unreliable on k3d flannel, ADR-0014). A donations upstream that always
 * returns 500 feeds the gateway's real circuit breaker: the first `threshold` responses leak the
 * 500, then the breaker opens and the gateway settles to a typed 502 `dependency_failure` — it
 * never leaks a naked 500 indefinitely. With the breaker removed (CHAOS_DISABLE_CIRCUIT_BREAKER),
 * every request would forward the raw 500 — the deliberate-bug demo.
 */
const THRESHOLD = 3
const dummyContent = constantContent({ status: 200, body: {}, contentType: 'application/json' })

let upstream: Server
let baseUrl: string
let upstreamStatus = 500

beforeAll(async () => {
  upstream = createServer((_req, res) => {
    res.writeHead(upstreamStatus, { 'content-type': 'application/problem+json' })
    res.end(
      JSON.stringify({ type: 'about:blank', title: 'provider error', status: upstreamStatus }),
    )
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const addr = upstream.address()
  baseUrl = typeof addr === 'object' && addr !== null ? `http://127.0.0.1:${addr.port}` : ''
})

afterAll(() => {
  upstream.close()
})

function breakerClient() {
  const breaker = new CircuitBreaker(new FakeClock(), new SeededRandomness(1), {
    threshold: THRESHOLD,
    cooldownMs: 60_000,
    jitterRatio: 0,
  })
  const { request } = setupGatewayTest(dummyContent, {
    donations: createDonationsClient(baseUrl, { breaker, timeoutMs: 2_000 }),
  })
  return { breaker, request, path: `/api/communities/${SAMPLE.community}/donations` }
}

describe('gateway donations circuit breaker (experiment 06 property)', () => {
  it('settles to a typed 502 once sustained provider 500s trip the breaker', async () => {
    upstreamStatus = 500
    const { breaker, request, path } = breakerClient()

    // First THRESHOLD calls forward the raw provider 500 (breaker still closed).
    const leaked: number[] = []
    for (let i = 0; i < THRESHOLD; i += 1) leaked.push((await request.get(path)).status)
    expect(leaked).toEqual([500, 500, 500])

    // Breaker is now open: the next call fails fast as a typed 502 — no naked 500.
    const res = await request.get(path)
    expect(res.status).toBe(502)
    expect(breaker.open).toBe(true)
  })

  it('does NOT trip on the provider-up 502 (payment dep down) — reads stay available', async () => {
    upstreamStatus = 502
    const { breaker, request, path } = breakerClient()
    const statuses: number[] = []
    for (let i = 0; i < THRESHOLD + 3; i += 1) statuses.push((await request.get(path)).status)
    // A 502 means donations is UP (reporting its payment dep down); it must not open the breaker,
    // so every call still reaches the upstream and returns the 502 — none short-circuited.
    expect(statuses.every((s) => s === 502)).toBe(true)
    expect(breaker.open).toBe(false)
  })

  it('does NOT trip on a 4xx client error', async () => {
    upstreamStatus = 409
    const { breaker, request, path } = breakerClient()
    for (let i = 0; i < THRESHOLD + 3; i += 1) await request.get(path)
    expect(breaker.open).toBe(false)
  })
})
