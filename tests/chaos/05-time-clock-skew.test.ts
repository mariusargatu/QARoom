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
 * Chaos experiment 05 — TimeChaos: clock skew between services.
 *
 * FINDING (docs/failure-modes.md#05): the naive hypothesis "clock skew is harmless because
 * business logic reads the injected Clock" is REFUTED. OS skew poisons donations' postgres-js
 * connection pool (the driver's timeouts read OS time), flipping readiness to NotReady; at large
 * offsets it does not self-recover without a pod restart. The determinism abstraction governs
 * test-time control + LOGICAL (Lamport) ordering — not production immunity to OS TimeChaos.
 *
 * What this test asserts is the *defended* property: even when skew degrades donations, the
 * gateway stays BOUNDED — 200 or a typed 502, never a hang — because of its upstream timeout.
 *
 * Deliberate-bug demo (docs/failure-modes.md#05): widen GATEWAY_UPSTREAM_TIMEOUT_MS so a request
 * to the skew-degraded pod hangs past the probe budget → red.
 *
 * GATED behind CHAOS_TIMECHAOS=1 (needs the privileged chaos-daemon; on a pre-M6 cluster also the
 * `allowed-unsafe-sysctls` kubelet arg). Skipped otherwise. Running it may leave donations
 * NotReady — `kubectl rollout restart deploy/donations` to recover.
 */
const ENABLED = process.env.CHAOS_TIMECHAOS === '1'
const MANIFEST = resolve(import.meta.dirname, '../../chaos-experiments/05-time-clock-skew.yaml')
const PROBE_BUDGET_MS = 6_000
const DONATIONS_PATH = `/api/communities/${EXAMPLE_COMMUNITY_ID}/donations`

let gateway: PortForward

async function probeDonations(): Promise<ProbeResult> {
  const status = await fetch(`${gateway.url}${DONATIONS_PATH}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(PROBE_BUDGET_MS),
  })
    .then((r) => r.status)
    .catch(() => 0)
  // Bounded: 200 healthy, or a typed 502 when skew has degraded donations — never a hang (0).
  return { ok: status === 200 || status === 502, detail: `status ${status}` }
}

// Hooks live inside the gated describe so they are skipped (with the test) when disabled — no
// in-test conditional (qaroom/no-conditional-in-test).
describe.skipIf(!ENABLED)('chaos 05: clock skew', () => {
  beforeAll(async () => {
    gateway = await portForward({
      namespace: 'qaroom',
      target: 'svc/gateway',
      localPort: 18085,
      remotePort: 80,
    })
  }, 120_000)
  afterAll(() => gateway?.stop())

  it('keeps the gateway bounded (200/502, no hang) when skew degrades donations', async () => {
    const run = await runSteadyState({
      hypothesis: {
        name: 'gateway donations bounded (200/502) under OS skew',
        probe: probeDonations,
      },
      inject: async () => {
        await applyManifest(MANIFEST)
        await waitForInjection('timechaos', 'time-clock-skew', 'qaroom')
      },
      heal: async () => {
        await deleteManifest(MANIFEST)
      },
      samples: 3,
      intervalMs: 500,
    })
    expect(run.before.held).toBe(true)
    expect(run.during.held, `during skew: ${JSON.stringify(run.during.results)}`).toBe(true)
  })
})
