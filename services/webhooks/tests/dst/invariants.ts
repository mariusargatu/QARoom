import { signWebhook } from '@qaroom/contracts/webhook-hmac'
import { replayTag } from './provenance'
import type { History, LedgerRow, PostRecord } from './types'
import type { SimWorld } from './world'

/**
 * The INVARIANT CHECKER (DST component 6). The simulation explores the delivery state space under
 * fuzzed faults; these oracles are the SAME safety + liveness properties spec/tla/WebhookDelivery.tla
 * proves, now asserted against the actual run history:
 *
 *   - EventuallyTerminal  — every delivery reaches Delivered or DeadLettered (TLA `EventuallyTerminal`)
 *   - at-least-once       — a Delivered row implies the receiver really returned 2xx (TLA `NoSilentDrop`)
 *   - ingestion dedup     — no duplicate row per (subscription, event) (the unique-index boundary)
 *   - receiver dedup      — a delivery's retries carry ONE stable id, so a receiver can dedupe
 *   - HMAC binds time     — every signature equals `sign(secret, ts, body)` AND depends on the ts
 *
 * Every violation is a REAL FINDING: the throw carries `seed + commit` so the exact world replays.
 * We never soften an oracle to make a seed pass (the invariant-source rule); a red means fix the
 * code (or surface the conflict). `assertLegalDeliveryCommit` already runs INSIDE the worker on
 * every committed transition, so an off-protocol edge throws mid-simulation before reaching here.
 */
export function assertDeliveryInvariants(history: History, world: SimWorld): void {
  const seed = world.seed
  // A sim that explored nothing must not pass silently: the worker has to have POSTed at least once.
  if (history.posts.length === 0) {
    throw new Error(`DST explored nothing: zero outbound POSTs — ${replayTag(seed)}`)
  }
  assertEventuallyTerminal(history.ledger, seed)
  assertAtLeastOnce(history.ledger, history.posts, seed)
  assertIngestionDedup(history.ledger, seed)
  assertReceiverDedup(history.posts, seed)
  assertHmacBindsTimestamp(history.ledger, history.posts, world)
}

/** Liveness: no delivery is left stuck in a non-terminal state once the world has quiesced. */
function assertEventuallyTerminal(ledger: LedgerRow[], seed: number): void {
  const stuck = ledger.filter((r) => r.status !== 'Delivered' && r.status !== 'DeadLettered')
  if (stuck.length > 0) {
    const ids = stuck.map((r) => `${r.id}=${r.status}`).join(', ')
    throw new Error(
      `EventuallyTerminal violated: ${stuck.length} delivery(ies) never reached a terminal ` +
        `state [${ids}] — ${replayTag(seed)}`,
    )
  }
}

/**
 * At-least-once / no-silent-drop: a row reported Delivered must correspond to a receiver POST that
 * actually returned 2xx; a DeadLettered row must NOT have had an accepted POST (else it should have
 * been Delivered). The `CHAOS_WEBHOOK_DROP_ON_FAIL` bug marks a FAILED send Delivered, so the down
 * endpoint's row is Delivered with no 2xx POST behind it — caught here.
 */
function assertAtLeastOnce(ledger: LedgerRow[], posts: PostRecord[], seed: number): void {
  const acceptedDeliveries = new Set<string>()
  for (const post of posts) {
    if (post.result.kind === 'success') acceptedDeliveries.add(post.deliveryId)
  }
  for (const row of ledger) {
    if (row.status === 'Delivered' && !acceptedDeliveries.has(row.id)) {
      throw new Error(
        `at-least-once violated (NoSilentDrop): delivery ${row.id} is Delivered but no receiver ` +
          `POST returned 2xx — the event was silently dropped — ${replayTag(seed)}`,
      )
    }
    if (row.status === 'DeadLettered' && acceptedDeliveries.has(row.id)) {
      throw new Error(
        `at-least-once violated: delivery ${row.id} was DeadLettered yet the receiver accepted a ` +
          `POST (2xx) for it — a successful delivery was discarded — ${replayTag(seed)}`,
      )
    }
  }
}

/** Ingestion dedup: the per-(subscription, event) unique index must keep redeliveries from
 * duplicating ledger rows, no matter how many times the fault injector re-fed the event. */
function assertIngestionDedup(ledger: LedgerRow[], seed: number): void {
  const keys = ledger.map((r) => `${r.subscriptionId}::${r.eventId}`)
  if (new Set(keys).size !== keys.length) {
    throw new Error(
      `ingestion dedup violated: duplicate delivery rows for the same (subscription, event) — a ` +
        `redelivered event was fanned out twice — ${replayTag(seed)}`,
    )
  }
}

/** Receiver dedup: all attempts of one delivery must carry the SAME `X-QARoom-Delivery-Id`, so a
 * deduping receiver recognises a redelivery. `CHAOS_WEBHOOK_UNSTABLE_DELIVERY_ID` breaks this. */
function assertReceiverDedup(posts: PostRecord[], seed: number): void {
  const headerByDelivery = new Map<string, string>()
  for (const post of posts) {
    const seen = headerByDelivery.get(post.deliveryId)
    if (seen !== undefined && seen !== post.headerDeliveryId) {
      throw new Error(
        `receiver dedup violated: delivery ${post.deliveryId} was sent under two different ` +
          `X-QARoom-Delivery-Id headers (${seen}, ${post.headerDeliveryId}) — a receiver cannot ` +
          `dedupe its redeliveries — ${replayTag(seed)}`,
      )
    }
    headerByDelivery.set(post.deliveryId, post.headerDeliveryId)
  }
}

/**
 * HMAC binds the timestamp: every recorded signature must equal `sign(secret, ts, body)`, AND must
 * change when the timestamp changes (so a captured pair cannot be replayed). The
 * `CHAOS_WEBHOOK_SIGN_BODY_ONLY` bug signs the body alone, breaking the first check.
 */
function assertHmacBindsTimestamp(ledger: LedgerRow[], posts: PostRecord[], world: SimWorld): void {
  const subByDelivery = new Map(ledger.map((r) => [r.id, r.subscriptionId]))
  for (const post of posts) {
    const subId = subByDelivery.get(post.deliveryId)
    const secret = subId ? world.secretBySubId.get(subId) : undefined
    if (!secret) continue // every POST maps to a ledger row; defensive only
    const expected = signWebhook(secret, post.timestamp, post.body)
    if (expected !== post.signature) {
      throw new Error(
        `HMAC violated: signature for delivery ${post.deliveryId} does not equal ` +
          `sign(secret, timestamp, body) — the timestamp is not bound in — ${replayTag(world.seed)}`,
      )
    }
    const shifted = signWebhook(secret, `${post.timestamp}-replayed`, post.body)
    if (shifted === post.signature) {
      throw new Error(
        `HMAC replay risk: signature for delivery ${post.deliveryId} is unchanged when the ` +
          `timestamp changes — the timestamp is not bound in — ${replayTag(world.seed)}`,
      )
    }
  }
}
