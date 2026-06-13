import { resolve } from 'node:path'
import { EXAMPLE_COMMUNITY_ID } from '@qaroom/contracts'
import {
  applyManifest,
  deleteManifest,
  type PortForward,
  type ProbeResult,
  portForward,
  runSteadyState,
} from '@qaroom/testing-utils/chaos'
import { GatewayClient } from '@qaroom/testing-utils/live-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Chaos experiment 06 — LitmusChaos HTTPChaos: donations returns 500.
 *
 * Steady-state hypothesis: under provider 500s the gateway's donations endpoint stays bounded —
 * 200, or a typed 502 (the circuit breaker opening) — never a naked 500 leaking through.
 *
 * Deliberate-bug demo (docs/failure-modes.md#06): CHAOS_DISABLE_CIRCUIT_BREAKER=1 on the gateway
 * → the raw 500 leaks → red.
 *
 * GATED: needs the LitmusChaos operator + pod-http-status-code experiment + RBAC
 * (`pnpm chaos:install:litmus` then apply the experiment CR). Set CHAOS_LITMUS=1 to run it;
 * skipped otherwise so the suite stays green where Litmus is not installed.
 */
const ENABLED = process.env.CHAOS_LITMUS === '1'
const MANIFEST = resolve(
  import.meta.dirname,
  '../../chaos-experiments/06-http-gateway-500-donations.yaml',
)
const PROBE_BUDGET_MS = 8_000
const DONATIONS_PATH = `/api/communities/${EXAMPLE_COMMUNITY_ID}/donations`
// > the gateway breaker threshold, so the warm-up reliably trips it before the during-phase.
const WARMUP_REQUESTS = 8

let gateway: PortForward
let client: GatewayClient

async function donationsStatus(): Promise<number> {
  return (await client.get(DONATIONS_PATH)).status
}

async function probeDonations(): Promise<ProbeResult> {
  const status = await donationsStatus()
  // The whole point: never a naked 5xx other than the gateway's own typed 502.
  return { ok: status === 200 || status === 502, detail: `status ${status}` }
}

// Hooks live inside the gated describe so they are skipped (with the test) when disabled — no
// in-test conditional (qaroom/no-conditional-in-test).
describe.skipIf(!ENABLED)('chaos 06: gateway 500 for donations (Litmus)', () => {
  beforeAll(async () => {
    gateway = await portForward({
      namespace: 'qaroom',
      target: 'svc/gateway',
      localPort: 18086,
      remotePort: 80,
    })
    client = new GatewayClient({
      baseUrl: gateway.url,
      requestBudgetMs: PROBE_BUDGET_MS,
      idempotencySeed: 'chaos-06',
    })
  }, 120_000)
  afterAll(() => gateway?.stop())

  it('degrades to a typed 502 (breaker), never a naked 500', async () => {
    const run = await runSteadyState({
      hypothesis: {
        name: 'donations is 200 or typed 502, never a naked 500',
        probe: probeDonations,
      },
      inject: async () => {
        await applyManifest(MANIFEST)
        // Warm up past the breaker threshold: the breaker leaks the first N raw 500s by design
        // (circuit-breaker.spec.ts asserts that), so the during-phase asserts the SETTLED state
        // (typed 502) rather than racing the leak window.
        for (let i = 0; i < WARMUP_REQUESTS; i += 1) await donationsStatus()
      },
      heal: async () => {
        await deleteManifest(MANIFEST)
      },
      samples: 4,
      intervalMs: 500,
    })
    expect(run.before.held).toBe(true)
    expect(run.during.held, `during HTTP 500 chaos: ${JSON.stringify(run.during.results)}`).toBe(
      true,
    )
  })
})
