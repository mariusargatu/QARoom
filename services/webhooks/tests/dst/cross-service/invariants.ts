import { parseSubject } from '@qaroom/contracts'
import { signWebhook } from '@qaroom/contracts/webhook-hmac'
import { classifyEventType } from '../../../src/consumer'
import { replayTag } from '../provenance'
import type { LedgerRow, PostRecord } from '../types'
import type { ComposedHistory } from './types'
import type { ComposedWorld } from './world'

/**
 * The CROSS-SERVICE INVARIANT CHECKER (DST component 6). The single-service DST (T20) proved webhooks
 * correct in isolation; this asserts the properties that only EXIST once content and webhooks are
 * composed over a real bus — diffing content's outbox (what was produced) against the webhooks ledger
 * (what was delivered):
 *
 *   - no event lost      — every NOTIFYING produced event yields a terminal delivery for each matching
 *                          subscription (the planted dropped-publish reds exactly this).
 *   - no event duplicated — at most one delivery row per (subscription, event), and no ledger row for
 *                          an event content never produced (a phantom). Holds even though the broker
 *                          redelivers (at-least-once) — the dedup boundary collapses the replay.
 *   - tenant preserved    — `tenant.id` is identical at every hop: outbox community → bus header →
 *                          ledger row. A subject can't carry a tenant its position-3 community denies.
 *   - moderator consumed  — the seeded sim consumer decided every post.created the bus delivered it,
 *                          exactly once (the bolted-on LLM is just another well-behaved consumer).
 *   - HMAC binds time     — every delivery signature equals `sign(secret, ts, body)` and depends on ts.
 *
 * Every violation is a REAL FINDING carrying `seed + commit` so the exact composed world replays. We
 * never soften an oracle to make a seed pass (the invariant-source rule) — a red means fix the code or
 * surface the conflict.
 */
export function assertComposedInvariants(history: ComposedHistory, world: ComposedWorld): void {
  const seed = world.seed
  if (history.sourceEvents.length === 0) {
    throw new Error(`composed DST explored nothing: content emitted no events — ${replayTag(seed)}`)
  }
  if (history.posts.length === 0) {
    throw new Error(`composed DST explored nothing: zero outbound POSTs — ${replayTag(seed)}`)
  }
  assertNoLostNoDuplicate(history, world)
  assertTenantPreserved(history, world)
  assertModeratorConsumed(history, world)
  assertHmacBindsTimestamp(history, world)
}

/**
 * The heart of the cross-service oracle: content's outbox vs the webhooks ledger. Every subscription
 * in this world listens to all event types, so a produced event is "notifying" for a subscription iff
 * they share a community.
 */
function assertNoLostNoDuplicate(history: ComposedHistory, world: ComposedWorld): void {
  const seed = world.seed
  const ledgerByKey = new Map<string, LedgerRow[]>()
  for (const row of history.ledger) {
    const key = `${row.subscriptionId}::${row.eventId}`
    const list = ledgerByKey.get(key) ?? []
    list.push(row)
    ledgerByKey.set(key, list)
  }

  // No duplicate: the dedup boundary (processed_events + the unique index) must collapse every
  // at-least-once redelivery to a single row per (subscription, event).
  for (const [key, rows] of ledgerByKey) {
    if (rows.length > 1) {
      throw new Error(
        `event duplicated across the boundary: ${rows.length} delivery rows for (subscription, ` +
          `event) ${key} — a redelivery was fanned out twice — ${replayTag(seed)}`,
      )
    }
  }

  // No phantom: every delivered event must trace back to a real produced event.
  const producedIds = new Set(history.sourceEvents.map((e) => e.eventId))
  for (const row of history.ledger) {
    if (!producedIds.has(row.eventId)) {
      throw new Error(
        `phantom delivery: ledger row ${row.id} references event ${row.eventId} that content never ` +
          `produced — ${replayTag(seed)}`,
      )
    }
  }

  // No loss: every notifying produced event yields a terminal delivery for each matching subscription.
  const subsByCommunity = new Map<string, typeof world.subscriptions>()
  for (const sub of world.subscriptions) {
    const list = subsByCommunity.get(sub.communityId) ?? []
    list.push(sub)
    subsByCommunity.set(sub.communityId, list)
  }
  for (const event of history.sourceEvents) {
    if (classifyEventType(event.eventName) === null) continue // not a subscribable feed event
    const matching = subsByCommunity.get(event.communityId) ?? []
    for (const sub of matching) {
      const rows = ledgerByKey.get(`${sub.id}::${event.eventId}`) ?? []
      const row = rows[0]
      if (row === undefined) {
        throw new Error(
          `event lost across the boundary: notifying ${event.eventName} ${event.eventId} ` +
            `(community ${event.communityId}) produced no delivery for subscription ${sub.id} — ` +
            `${replayTag(seed)}`,
        )
      }
      if (row.status !== 'Delivered' && row.status !== 'DeadLettered') {
        throw new Error(
          `EventuallyTerminal violated across the boundary: delivery ${row.id} for event ` +
            `${event.eventId} never reached a terminal state (${row.status}) — ${replayTag(seed)}`,
        )
      }
    }
  }
}

/** `tenant.id` is identical at every hop: outbox community → bus header → ledger row. */
function assertTenantPreserved(history: ComposedHistory, world: ComposedWorld): void {
  const seed = world.seed
  const communityByEvent = new Map(history.sourceEvents.map((e) => [e.eventId, e.communityId]))

  for (const row of history.ledger) {
    const expected = communityByEvent.get(row.eventId)
    if (expected !== undefined && row.communityId !== expected) {
      throw new Error(
        `tenant.id not preserved end to end: delivery ${row.id} for event ${row.eventId} carries ` +
          `community ${row.communityId}, but content produced it for ${expected} — ${replayTag(seed)}`,
      )
    }
  }

  // On the bus, the `tenant.id` header must equal the subject's load-bearing position-3 community.
  for (const rec of history.broker) {
    const parsed = parseSubject(rec.subject)
    if (parsed.communityId !== '*' && rec.tenant !== parsed.communityId) {
      throw new Error(
        `tenant.id not preserved on the bus: message ${rec.msgId} on subject ${rec.subject} carries ` +
          `tenant ${rec.tenant} — ${replayTag(seed)}`,
      )
    }
  }
}

/**
 * The moderator stub decided every post.created the bus delivered it, exactly once — and preserved the
 * tenant. This is the DST demonstration that the bolted-on LLM is just another consumer on the bus: it
 * loses nothing and double-decides nothing, with its one non-deterministic step (the model call)
 * stubbed at the kernel boundary.
 */
function assertModeratorConsumed(history: ComposedHistory, world: ComposedWorld): void {
  const seed = world.seed
  const decidedIds = new Set(history.decisions.map((d) => d.eventId))
  for (const rec of history.broker) {
    if (rec.eventName !== 'post.created') continue
    if (!decidedIds.has(rec.msgId)) {
      throw new Error(
        `moderator stub skipped a delivered post.created (${rec.msgId}): the kernel-boundary consumer ` +
          `lost an event off the shared bus — ${replayTag(seed)}`,
      )
    }
  }
  const ids = history.decisions.map((d) => d.eventId)
  if (new Set(ids).size !== ids.length) {
    throw new Error(
      `moderator stub recorded duplicate decisions — its consumer dedup failed — ${replayTag(seed)}`,
    )
  }
  const communityByEvent = new Map(history.sourceEvents.map((e) => [e.eventId, e.communityId]))
  for (const decision of history.decisions) {
    const expected = communityByEvent.get(decision.eventId)
    if (expected !== undefined && decision.communityId !== expected) {
      throw new Error(
        `moderator decision for ${decision.eventId} carries community ${decision.communityId}, but ` +
          `content produced it for ${expected} — ${replayTag(seed)}`,
      )
    }
  }
}

/**
 * Every recorded signature must equal `sign(secret, ts, body)` AND change when the timestamp changes
 * (so a captured pair cannot be replayed). Same oracle as the single-service DST — here proving the
 * signing held across the whole composed path, secret and all.
 */
function assertHmacBindsTimestamp(history: ComposedHistory, world: ComposedWorld): void {
  const seed = world.seed
  const subByDelivery = new Map(history.ledger.map((r: LedgerRow) => [r.id, r.subscriptionId]))
  for (const post of history.posts as PostRecord[]) {
    const subId = subByDelivery.get(post.deliveryId)
    const secret = subId ? world.secretBySubId.get(subId) : undefined
    if (!secret) continue // every POST maps to a ledger row; defensive only
    const expected = signWebhook(secret, post.timestamp, post.body)
    if (expected !== post.signature) {
      throw new Error(
        `HMAC violated: signature for delivery ${post.deliveryId} does not equal ` +
          `sign(secret, timestamp, body) — ${replayTag(seed)}`,
      )
    }
    const shifted = signWebhook(secret, `${post.timestamp}-replayed`, post.body)
    if (shifted === post.signature) {
      throw new Error(
        `HMAC replay risk: signature for delivery ${post.deliveryId} is unchanged when the timestamp ` +
          `changes — the timestamp is not bound in — ${replayTag(seed)}`,
      )
    }
  }
}
