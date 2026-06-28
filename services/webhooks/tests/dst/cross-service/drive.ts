import { EXAMPLE_USER_ID } from '@qaroom/contracts'
import { processEvent, readEventHeaders, rowsOf } from '@qaroom/messaging'
import { sql } from 'drizzle-orm'
import { classifyEventType, fanoutHandler } from '../../../src/consumer'
import type { WebhooksDb } from '../../../src/db/client'
import { replayTag } from '../provenance'
import type { LedgerRow } from '../types'
import type { BrokerRecord, ComposedHistory, SourceEvent } from './types'
import type { ComposedWorld } from './world'

/**
 * The composed DRIVE loop (DST components 2 + 6) across the SERVICE BOUNDARY. One tick advances every
 * stage once — content's outbox relay → the broker → webhooks' fan-out → the moderator stub → the
 * delivery worker — so an event can travel producer-to-terminal-delivery in a single tick. When a
 * tick makes no progress but deliveries are scheduled for a future instant, we JUMP the virtual clock
 * to the next retry rather than sleeping, compressing capped backoff into microseconds. The whole
 * pipeline is driven by `drainOnce` ticks (TimerFactory was deferred; `drainOnce` exists today), so
 * nothing here touches a real timer — it is deterministic end to end.
 *
 * The tick cap is the cross-service liveness witness: an event that never reaches a terminal delivery
 * (e.g. a dropped publish that strands a notifying post) would spin here forever, so exceeding the cap
 * is itself a failure — reported with `seed + commit` for replay.
 */

const MAX_TICKS = 2_000
/** Advance the clock between workload calls so each outbox row gets a distinct `created_at` (stable
 *  relay drain order — the precondition for a byte-identical composed history). */
const WORKLOAD_STEP_MS = 1_000

export async function runComposed(world: ComposedWorld): Promise<ComposedHistory> {
  await applyWorkload(world)

  let ticks = 0
  for (;;) {
    ticks += 1
    if (ticks > MAX_TICKS) {
      throw new Error(
        `liveness: composed content→webhooks run did not quiesce within ${MAX_TICKS} ticks ` +
          `(EventuallyTerminal violated across the boundary) — ${replayTag(world.seed)}`,
      )
    }

    let moved = 0
    moved += await world.relay.drainOnce() // content outbox → broker
    moved += await fanoutDrain(world) // broker → webhooks delivery ledger
    moved += await moderatorDrain(world) // broker → moderator decisions
    moved += await world.worker.drainOnce() // ledger → outbound POSTs
    if (moved > 0) continue

    const nextMs = await minNextAttemptMs(world.webhooksDb)
    if (nextMs === null) break // no producer work pending and no delivery due — quiescent
    world.clock.set(nextMs)
  }

  return buildComposedHistory(world, ticks)
}

/** Replay the seeded workload through content's REAL HTTP surface (create posts, then cast votes). */
async function applyWorkload(world: ComposedWorld): Promise<void> {
  const postIds: string[] = []
  for (const action of world.workload) {
    world.clock.advance(WORKLOAD_STEP_MS)
    if (action.kind === 'post') {
      const res = await world.contentRequest.post(
        `/api/communities/${action.communityId}/posts`,
        { author_id: EXAMPLE_USER_ID, title: action.title, body: action.body },
        { 'idempotency-key': action.idemKey },
      )
      postIds.push((res.json as { id: string }).id)
      world.cross.postsCreated += 1
    } else {
      const postId = postIds[action.postIndex]
      if (postId === undefined) continue // defensive: votes only ever index an earlier post
      await world.contentRequest.post(
        `/api/posts/${postId}/votes`,
        { voter_id: action.voterId, value: action.value },
        { 'idempotency-key': action.idemKey },
      )
      world.cross.votesCast += 1
    }
  }
}

/**
 * Drain the webhooks fan-out from the broker: poll un-acked messages, run the REAL ingestion path
 * (`processEvent` → `fanoutHandler`) so the per-(durable, event) and per-(subscription, event) dedup
 * boundaries are exercised exactly as in production, then ack. ONCE per world the first message is
 * left un-acked — a seeded at-least-once redelivery the dedup boundary must absorb (no duplicate row).
 */
async function fanoutDrain(world: ComposedWorld): Promise<number> {
  const msgs = world.broker.poll(world.fanoutDurable)
  for (const msg of msgs) {
    const meta = readEventHeaders(msg.headers)
    const eventType = classifyEventType(meta.eventName)
    if (eventType) {
      await processEvent(
        world.webhooksDb,
        world.fanoutDurable,
        { eventId: meta.eventId, communityId: meta.communityId, payload: msg.payload },
        fanoutHandler(
          { ids: world.webhooksIds, clock: world.clock },
          { eventType, communityId: meta.communityId, eventId: meta.eventId },
        ),
        world.clock,
      )
    }
    if (world.redeliver.budget > 0 && !world.redeliver.done.has(msg.msgId)) {
      world.redeliver.budget -= 1
      world.redeliver.done.add(msg.msgId)
      world.cross.redelivered += 1
      continue // skip the ack → re-polled next tick → the dedup boundary swallows the replay
    }
    world.broker.ack(world.fanoutDurable, msg.seq)
  }
  return msgs.length
}

/** Drain the moderator stub from the broker (its OWN durable cursor): one canned decision per event. */
async function moderatorDrain(world: ComposedWorld): Promise<number> {
  const msgs = world.broker.poll(world.moderatorDurable)
  for (const msg of msgs) {
    const meta = readEventHeaders(msg.headers)
    if (!world.moderator.seen.has(meta.eventId)) {
      world.moderator.decide({
        eventId: meta.eventId,
        communityId: meta.communityId,
        payload: msg.payload,
      })
      world.cross.decisions += 1
    }
    world.broker.ack(world.moderatorDurable, msg.seq)
  }
  return msgs.length
}

/** Epoch-ms of the earliest scheduled retry among non-terminal deliveries, or null if all terminal. */
async function minNextAttemptMs(db: WebhooksDb): Promise<number | null> {
  const rows = rowsOf<{ next_ms: string | number | null }>(
    await db.execute(sql`
      SELECT (EXTRACT(EPOCH FROM MIN(next_attempt_at)) * 1000)::bigint AS next_ms
      FROM webhook_deliveries
      WHERE status IN ('Pending', 'Retrying')
    `),
  )
  const raw = rows[0]?.next_ms
  return raw === null || raw === undefined ? null : Number(raw)
}

async function buildComposedHistory(world: ComposedWorld, ticks: number): Promise<ComposedHistory> {
  const sourceEvents = await snapshotOutbox(world)
  const ledger = await snapshotLedger(world.webhooksDb)
  for (const row of ledger) {
    if (row.status === 'Delivered') world.receiverCoverage.terminalDelivered += 1
    else if (row.status === 'DeadLettered') world.receiverCoverage.terminalDeadLettered += 1
  }
  world.cross.brokerAccepted = world.broker.stats.accepted
  world.cross.brokerDeduped = world.broker.stats.deduped
  world.cross.brokerDropped = world.broker.stats.dropped

  const broker: BrokerRecord[] = world.broker.log.map((m) => {
    const meta = readEventHeaders(m.headers)
    return {
      seq: m.seq,
      subject: m.subject,
      eventName: meta.eventName,
      msgId: m.msgId,
      tenant: meta.communityId,
    }
  })

  return {
    seed: world.seed,
    sourceEvents,
    broker,
    ledger,
    posts: world.receiver.posts,
    decisions: world.moderator.decisions,
    receiverCoverage: world.receiverCoverage,
    cross: world.cross,
    ticks,
  }
}

/** content's OUTBOX, post-run — the producer-side source of truth (row id IS the `Nats-Msg-Id`). */
async function snapshotOutbox(world: ComposedWorld): Promise<SourceEvent[]> {
  const rows = rowsOf<{
    id: string
    subject: string
    event_name: string
    community_id: string
    published_at: string | null
  }>(
    await world.contentDb.execute(sql`
      SELECT id, subject, event_name, community_id, published_at
      FROM outbox
      ORDER BY created_at, id
    `),
  )
  return rows.map((r) => ({
    eventId: r.id,
    subject: r.subject,
    eventName: r.event_name,
    communityId: r.community_id,
    published: r.published_at !== null,
  }))
}

/** webhooks' delivery ledger — the consumer-side ledger the cross-service oracle diffs the outbox against. */
async function snapshotLedger(db: WebhooksDb): Promise<LedgerRow[]> {
  return rowsOf<LedgerRow>(
    await db.execute(sql`
      SELECT id, subscription_id AS "subscriptionId", community_id AS "communityId",
             event_id AS "eventId", status, attempt, last_status_code AS "lastStatusCode"
      FROM webhook_deliveries
      ORDER BY id
    `),
  )
}
