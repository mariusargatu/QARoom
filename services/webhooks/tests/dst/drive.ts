import { rowsOf } from '@qaroom/messaging'
import { failingDb } from '@qaroom/testing-utils/scenario'
import { sql } from 'drizzle-orm'
import type { WebhooksDb } from '../../src/db/client'
import { createDeliveryWorker, type DeliveryWorker } from '../../src/worker'
import { feedEvents } from './event-bus'
import { replayTag } from './provenance'
import type { History, LedgerRow } from './types'
import type { SimWorld } from './world'

/**
 * The DRIVE loop (DST components 2 + 6): feed the world's events, then drain the real delivery
 * worker to quiescence using the VIRTUAL CLOCK — when nothing is due, jump time to the next
 * scheduled retry instead of sleeping, compressing hours of capped backoff into microseconds. A
 * seeded crash is injected once mid-flight (a ledger write fails AFTER the POST), so the worker's
 * transaction rolls back and the row is re-claimed: the at-least-once spine, fuzzed.
 *
 * The pass cap is the liveness witness: a delivery that never reaches a terminal state would spin
 * here forever, so exceeding the cap IS an `EventuallyTerminal` failure (reported with seed+commit).
 */

/** Generous bound on drain cycles; a well-behaved world reaches quiescence in far fewer. */
const MAX_PASSES = 2_000

export async function runSimulation(world: SimWorld): Promise<History> {
  await feedEvents(world.db, world.clock, world.ids, world.queue)

  const clean = makeWorker(world, world.db)
  // A single guaranteed crash, on the first pass (which always has due rows): the POST lands, then
  // the persist throws, the transaction rolls back, and the row is re-claimed next pass.
  let crashRemaining = 1
  let passes = 0

  for (;;) {
    passes += 1
    if (passes > MAX_PASSES) {
      throw new Error(
        `liveness: webhook deliveries did not reach quiescence within ${MAX_PASSES} passes ` +
          `(EventuallyTerminal violated) — ${replayTag(world.seed)}`,
      )
    }

    if (crashRemaining > 0 && passes === 1) {
      crashRemaining -= 1
      const crashed = await drainCrash(world)
      world.coverage.crashMidflight += crashed
      continue
    }

    const attempted = await clean.drainOnce()
    if (attempted > 0) continue

    const nextMs = await minNextAttemptMs(world.db)
    if (nextMs === null) break // every delivery is terminal — quiescent
    world.clock.set(nextMs)
  }

  return buildHistory(world, passes)
}

/** Drain one pass through a db whose first delivery-persist write fails (a mid-flight crash). */
async function drainCrash(world: SimWorld): Promise<number> {
  // nth:2 execute = the first row's persist UPDATE (execute #1 is the claim SELECT). The POST has
  // already been sent to the receiver by then, so the rollback yields a genuine at-least-once
  // duplicate the receiver must dedupe.
  const faulted = failingDb(world.db, { op: 'execute', nth: 2 })
  const worker = makeWorker(world, faulted)
  try {
    await worker.drainOnce()
    return 0 // no due row to crash on this pass — the fault never armed
  } catch {
    return 1 // the injected write failure rolled the pass back; the row stays re-claimable
  }
}

function makeWorker(world: SimWorld, db: WebhooksDb): DeliveryWorker {
  return createDeliveryWorker({
    db,
    clock: world.clock,
    ids: world.ids,
    randomness: world.randomness,
    sender: world.receiver,
    deliverySink: world.sink,
  })
}

/** Epoch-ms of the earliest scheduled retry among non-terminal rows, or null if all are terminal. */
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

async function buildHistory(world: SimWorld, passes: number): Promise<History> {
  const ledger = await snapshotLedger(world.db)
  for (const row of ledger) {
    if (row.status === 'Delivered') world.coverage.terminalDelivered += 1
    else if (row.status === 'DeadLettered') world.coverage.terminalDeadLettered += 1
  }
  return {
    seed: world.seed,
    posts: world.receiver.posts,
    transitions: world.sink.records,
    ledger,
    coverage: world.coverage,
    passes,
  }
}

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
