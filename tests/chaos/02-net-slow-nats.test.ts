import { resolve } from 'node:path'
import { EXAMPLE_COMMUNITY_ID, EXAMPLE_USER_ID } from '@qaroom/contracts'
import {
  applyManifest,
  deleteManifest,
  type PortForward,
  type ProbeResult,
  portForward,
  runSteadyState,
  waitForInjection,
} from '@qaroom/testing-utils/chaos'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Chaos experiment 02 — NetworkChaos: slow NATS broker.
 *
 * Steady-state hypothesis: creating a donation returns promptly (201 enabled / 409 gated / 502
 * unreachable) within the probe budget — the request path commits the outbox row and returns,
 * independent of broker latency. Holds healthy AND while NATS is delayed +2s.
 *
 * Deliberate-bug demo (docs/failure-modes.md#02): publish synchronously on the request path
 * (bypass the outbox) → a slow broker stalls the create → red.
 */
const MANIFEST = resolve(import.meta.dirname, '../../chaos-experiments/02-net-slow-nats.yaml')
const PROBE_BUDGET_MS = 4_000
const CREATE_PATH = `/api/communities/${EXAMPLE_COMMUNITY_ID}/donations`

let gateway: PortForward
let counter = 0

beforeAll(async () => {
  gateway = await portForward({
    namespace: 'qaroom',
    target: 'svc/gateway',
    localPort: 18082,
    remotePort: 80,
  })
}, 120_000)

afterAll(() => gateway?.stop())

async function probeCreate(): Promise<ProbeResult> {
  counter += 1
  const status = await fetch(`${gateway.url}${CREATE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `chaos-02-${counter}` },
    body: JSON.stringify({ donor_id: EXAMPLE_USER_ID, amount_cents: 500, currency: 'USD' }),
    signal: AbortSignal.timeout(PROBE_BUDGET_MS),
  })
    .then((r) => r.status)
    .catch(() => 0)
  return { ok: status === 201 || status === 409 || status === 502, detail: `status ${status}` }
}

describe('chaos 02: slow NATS broker', () => {
  it('keeps the donation create path fast — healthy and while NATS is delayed', async () => {
    const run = await runSteadyState({
      hypothesis: {
        name: 'donation create returns within budget (201/409/502)',
        probe: probeCreate,
      },
      inject: async () => {
        await applyManifest(MANIFEST)
        await waitForInjection('networkchaos', 'net-slow-nats', 'qaroom')
      },
      heal: async () => {
        await deleteManifest(MANIFEST)
      },
      samples: 3,
      intervalMs: 500,
    })
    expect(run.before.held, `healthy: ${JSON.stringify(run.before.results)}`).toBe(true)
    expect(run.during.held, `during slow NATS: ${JSON.stringify(run.during.results)}`).toBe(true)
  })
})
