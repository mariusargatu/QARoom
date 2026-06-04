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
  waitReady,
} from '@qaroom/testing-utils/chaos'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Chaos experiment 01 — PodChaos: donations-service unreachable (pod-failure).
 *
 * Steady-state hypothesis: the gateway's donations endpoint stays bounded — 200 healthy, a typed
 * 502 while the pod is failed, never a hang — and returns to 200 once Kubernetes restores the
 * pod (self-heal). The deeper guarantee (the durable consumer + dedup catch the flag projection
 * up after downtime) is unit-tested in @qaroom/messaging; here we assert the black-box
 * availability + recovery.
 *
 * Deliberate-bug demo (docs/failure-modes.md#01): widen GATEWAY_UPSTREAM_TIMEOUT_MS so the call
 * to the dead pod hangs past the probe budget → `run.during.held` is false → red.
 */
const MANIFEST = resolve(
  import.meta.dirname,
  '../../chaos-experiments/01-pod-donations-unreachable.yaml',
)
const PROBE_BUDGET_MS = 12_000
const DONATIONS_PATH = `/api/communities/${EXAMPLE_COMMUNITY_ID}/donations`

let gateway: PortForward

beforeAll(async () => {
  gateway = await portForward({
    namespace: 'qaroom',
    target: 'svc/gateway',
    localPort: 18081,
    remotePort: 80,
  })
}, 120_000)

afterAll(() => gateway?.stop())

async function donationsStatus(): Promise<number> {
  return fetch(`${gateway.url}${DONATIONS_PATH}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(PROBE_BUDGET_MS),
  })
    .then((r) => r.status)
    .catch(() => 0)
}

async function probeBounded(): Promise<ProbeResult> {
  const status = await donationsStatus()
  return { ok: status === 200 || status === 502, detail: `status ${status}` }
}

async function probeHealthy(): Promise<ProbeResult> {
  const status = await donationsStatus()
  return { ok: status === 200, detail: `status ${status}` }
}

describe('chaos 01: donations pod-failure', () => {
  it('keeps donations bounded while the pod is down and recovers to 200 after restart', async () => {
    const run = await runSteadyState({
      hypothesis: {
        name: 'donations endpoint responds within budget with 200 or 502',
        probe: probeBounded,
      },
      inject: async () => {
        await applyManifest(MANIFEST)
        await waitForInjection('podchaos', 'pod-donations-unreachable', 'qaroom')
      },
      heal: async () => {
        await deleteManifest(MANIFEST)
        await waitReady('qaroom', 'app.kubernetes.io/instance=donations')
      },
      samples: 3,
      intervalMs: 500,
      // after-phase asserts ACTIVE recovery to 200 (polls past any breaker cooldown), not merely
      // a bounded 502 — so a "never recovers" regression fails instead of passing.
      recover: { probe: probeHealthy, withinMs: 20_000 },
    })

    expect(run.before.held, `healthy baseline: ${JSON.stringify(run.before.results)}`).toBe(true)
    expect(run.during.held, `during pod-failure: ${JSON.stringify(run.during.results)}`).toBe(true)
    expect(run.after.held, `recovery to 200: ${JSON.stringify(run.after.results)}`).toBe(true)
  })
})
