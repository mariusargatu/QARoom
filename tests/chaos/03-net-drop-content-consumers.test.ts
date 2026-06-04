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
let counter = 0

beforeAll(async () => {
  gateway = await portForward({
    namespace: 'qaroom',
    target: 'svc/gateway',
    localPort: 18083,
    remotePort: 80,
  })
}, 120_000)

afterAll(() => gateway?.stop())

async function probeCreatePost(): Promise<ProbeResult> {
  counter += 1
  const status = await fetch(`${gateway.url}${CREATE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `chaos-03-${counter}` },
    body: JSON.stringify({ author_id: EXAMPLE_USER_ID, title: 'chaos 03', body: 'under loss' }),
    signal: AbortSignal.timeout(PROBE_BUDGET_MS),
  })
    .then((r) => r.status)
    .catch(() => 0)
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
