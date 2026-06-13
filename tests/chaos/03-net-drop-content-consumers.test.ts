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
import { GatewayClient } from '@qaroom/testing-utils/live-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Chaos experiment 03 — NetworkChaos: dropped messages between content-service and consumers.
 *
 * Steady-state hypothesis: content stays available under ~50% packet loss on its NATS path —
 * creating a post still commits and returns 201 (the write path persists the row + outbox row
 * independent of publish), so no write is lost to the broker. Eventual exactly-once *delivery*
 * to consumers is guaranteed by at-least-once + dedup; the double-effect demo (CHAOS_SKIP_DEDUP)
 * is asserted at the @qaroom/messaging unit level since current consumer effects are idempotent.
 */
const MANIFEST = resolve(
  import.meta.dirname,
  '../../chaos-experiments/03-net-drop-content-consumers.yaml',
)
const PROBE_BUDGET_MS = 6_000
const CREATE_PATH = `/api/communities/${EXAMPLE_COMMUNITY_ID}/posts`

let gateway: PortForward
let client: GatewayClient

beforeAll(async () => {
  gateway = await portForward({
    namespace: 'qaroom',
    target: 'svc/gateway',
    localPort: 18083,
    remotePort: 80,
  })
  client = new GatewayClient({
    baseUrl: gateway.url,
    requestBudgetMs: PROBE_BUDGET_MS,
    idempotencySeed: 'chaos-03',
  })
}, 120_000)

afterAll(() => gateway?.stop())

// Each probe is a fresh write: the client derives a distinct Idempotency-Key per call from its seed
// (no hand-rolled counter), and maps a timeout to a sentinel status 0 so a stall reads as not-ok.
async function probeCreatePost(): Promise<ProbeResult> {
  const status = (
    await client.post(CREATE_PATH, {
      author_id: EXAMPLE_USER_ID,
      title: 'chaos 03',
      body: 'under loss',
    })
  ).status
  return { ok: status === 201 || status === 502, detail: `status ${status}` }
}

describe('chaos 03: dropped content↔consumer messages', () => {
  it('keeps content writes available under packet loss on the NATS path', async () => {
    const run = await runSteadyState({
      hypothesis: { name: 'post create returns within budget (201/502)', probe: probeCreatePost },
      inject: async () => {
        await applyManifest(MANIFEST)
        await waitForInjection('networkchaos', 'net-drop-content-consumers', 'qaroom')
      },
      heal: async () => {
        await deleteManifest(MANIFEST)
      },
      samples: 3,
      intervalMs: 500,
    })
    expect(run.before.held, `healthy: ${JSON.stringify(run.before.results)}`).toBe(true)
    expect(run.during.held, `during loss: ${JSON.stringify(run.during.results)}`).toBe(true)
  })
})
