import { resolve } from 'node:path'
import { EXAMPLE_COMMUNITY_ID } from '@qaroom/contracts'
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
 * Chaos experiment 04 — StressChaos: Postgres under resource pressure.
 *
 * Steady-state hypothesis: the donations endpoint stays bounded under DB pressure — 200, or a
 * typed 502/503 if it sheds, within budget; never a hang. The bounded pool (pgPoolMax) +
 * readiness 503 are the mitigation. A *clean* connection-pool-exhaustion demo needs concurrent
 * load (M8 k6); this asserts availability-under-pressure.
 */
const MANIFEST = resolve(
  import.meta.dirname,
  '../../chaos-experiments/04-stress-pg-pool-exhaustion.yaml',
)
const PROBE_BUDGET_MS = 8_000
const DONATIONS_PATH = `/api/communities/${EXAMPLE_COMMUNITY_ID}/donations`

let gateway: PortForward

beforeAll(async () => {
  gateway = await portForward({
    namespace: 'qaroom',
    target: 'svc/gateway',
    localPort: 18084,
    remotePort: 80,
  })
}, 120_000)

afterAll(() => gateway?.stop())

async function probeDonations(): Promise<ProbeResult> {
  const status = await fetch(`${gateway.url}${DONATIONS_PATH}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(PROBE_BUDGET_MS),
  })
    .then((r) => r.status)
    .catch(() => 0)
  return { ok: status === 200 || status === 502 || status === 503, detail: `status ${status}` }
}

describe('chaos 04: Postgres under stress', () => {
  it('keeps donations bounded (200/502/503, no hang) under DB pressure', async () => {
    const run = await runSteadyState({
      hypothesis: { name: 'donations responds within budget (200/502/503)', probe: probeDonations },
      inject: async () => {
        await applyManifest(MANIFEST)
        await waitForInjection('stresschaos', 'stress-pg-pool-exhaustion', 'qaroom')
      },
      heal: async () => {
        await deleteManifest(MANIFEST)
      },
      samples: 3,
      intervalMs: 500,
    })
    expect(run.before.held, `healthy: ${JSON.stringify(run.before.results)}`).toBe(true)
    expect(run.during.held, `during PG stress: ${JSON.stringify(run.during.results)}`).toBe(true)
  })
})
