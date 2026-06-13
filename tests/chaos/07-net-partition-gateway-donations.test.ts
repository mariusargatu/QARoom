import { resolve } from 'node:path'
import { EXAMPLE_COMMUNITY_ID } from '@qaroom/contracts'
import {
  applyManifest,
  deleteManifest,
  forceDelete,
  type PortForward,
  type ProbeResult,
  portForward,
  runSteadyState,
  waitForInjection,
} from '@qaroom/testing-utils/chaos'
import { GatewayClient } from '@qaroom/testing-utils/live-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Chaos experiment 07 — partition between gateway and donations-service.
 *
 * Steady-state hypothesis: GET /api/communities/{id}/donations completes within the probe
 * budget with a 200 (healthy) or a 502 (partitioned) — it never hangs. The gateway's bounded
 * `AbortSignal.timeout` (mitigation) turns the partition into a prompt typed 502 rather than a
 * socket hang. The hypothesis must hold in the healthy baseline AND during the partition.
 *
 * Deliberate-bug demo (docs/failure-modes.md#07): widen GATEWAY_UPSTREAM_TIMEOUT_MS far past
 * PROBE_BUDGET_MS → the during-partition probe hangs → `run.during.held` is false → red.
 */
const MANIFEST = resolve(
  import.meta.dirname,
  '../../chaos-experiments/07-net-partition-gateway-donations.yaml',
)
// Comfortably above the gateway's 5s upstream timeout, well below an unbounded socket hang.
const PROBE_BUDGET_MS = 12_000
const DONATIONS_PATH = `/api/communities/${EXAMPLE_COMMUNITY_ID}/donations`

let gateway: PortForward
let client: GatewayClient

beforeAll(async () => {
  gateway = await portForward({
    namespace: 'qaroom',
    target: 'svc/gateway',
    localPort: 18080,
    remotePort: 80,
  })
  client = new GatewayClient({
    baseUrl: gateway.url,
    requestBudgetMs: PROBE_BUDGET_MS,
    idempotencySeed: 'chaos-07',
  })
}, 120_000)

afterAll(() => gateway?.stop())

async function donationsStatus(): Promise<number> {
  // status 0 = no response within the budget (i.e. a hang — the failure the mitigation prevents);
  // the shared client returns that sentinel on a timeout/refused fetch.
  return (await client.get(DONATIONS_PATH)).status
}

async function probeBounded(): Promise<ProbeResult> {
  const status = await donationsStatus()
  return { ok: status === 200 || status === 502, detail: `status ${status}` }
}

async function probeHealthy(): Promise<ProbeResult> {
  const status = await donationsStatus()
  return { ok: status === 200, detail: `status ${status}` }
}

describe('chaos 07: partition gateway ↔ donations', () => {
  it('keeps donations bounded during the partition and recovers to 200 after it heals', async () => {
    const run = await runSteadyState({
      hypothesis: {
        name: 'donations endpoint responds within budget with 200 or 502',
        probe: probeBounded,
      },
      inject: async () => {
        // Pre-clean any leftover partition CR whose finalizer stuck on a prior run's recovery
        // (k3d/flannel) — a Terminating same-named CR would otherwise block this apply.
        await forceDelete('networkchaos', 'net-partition-gateway-donations', 'qaroom')
        await applyManifest(MANIFEST)
        await waitForInjection('networkchaos', 'net-partition-gateway-donations', 'qaroom')
      },
      heal: async () => {
        await deleteManifest(MANIFEST)
      },
      samples: 3,
      intervalMs: 500,
      // after the partition heals, donations must actively return to 200 (not just stay 502).
      recover: { probe: probeHealthy, withinMs: 20_000 },
    })

    expect(run.before.held, `healthy baseline: ${JSON.stringify(run.before.results)}`).toBe(true)
    expect(run.during.held, `during partition: ${JSON.stringify(run.during.results)}`).toBe(true)
    expect(run.after.held, `recovery to 200: ${JSON.stringify(run.after.results)}`).toBe(true)
    expect(run.held).toBe(true)
  })
})
