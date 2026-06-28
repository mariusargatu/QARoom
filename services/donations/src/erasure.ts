import { USER_ERASED_FEED_SUBJECT, UserErasedEvent } from '@qaroom/contracts'
import type { Clock } from '@qaroom/determinism'
import {
  consumeDurable,
  type EventHandler,
  headersToRecord,
  type NatsHandle,
  processEvent,
  readEventHeaders,
  rowsOf,
  type SqlExecutor,
  settleByDeliveryBudget,
} from '@qaroom/messaging'
import { sql } from 'drizzle-orm'
import type { DonationsDb } from './db/client'

/** Durable consumer + dedup subscription name for the GDPR erasure cascade (ADR-0036). */
export const ERASURE_SUBSCRIPTION = 'donations-on-user-erased'

/** Poison threshold: after this many attempts a `user.erased` is dead-lettered, not redelivered forever. */
export const ERASURE_CONSUMER_MAX_DELIVERIES = 5

/**
 * Delete donations-service's slice of a user within ONE community (the GDPR erasure cascade,
 * ADR-0036): every donation the user made in that community. Returns how many rows were deleted.
 * Idempotent — re-running deletes nothing the second time, which (with `processed_events` dedup) makes
 * a redelivered erasure a no-op.
 */
export async function eraseUserData(
  tx: SqlExecutor,
  userId: string,
  communityId: string,
): Promise<number> {
  const deleted = rowsOf(
    await tx.execute(sql`
      DELETE FROM donations WHERE donor_id = ${userId} AND community_id = ${communityId} RETURNING id
    `),
  )
  return deleted.length
}

/**
 * Count donations-service's footprint for a user across every community: donations they made. The
 * `user-erased-everywhere` claim asserts this is 0 after the saga settles.
 */
export async function countUserFootprint(db: SqlExecutor, userId: string): Promise<number> {
  const res = await db.execute(sql`SELECT count(*) AS n FROM donations WHERE donor_id = ${userId}`)
  const rows = rowsOf<{ n: number | string }>(res)
  return Number(rows[0]?.n ?? 0)
}

/**
 * The `user.erased` consumer effect (dedup + tenant scope handled by `processEvent`). The pure handler
 * is unit-tested directly with no broker. donations has no deliberate-bug fault seam, so this handler
 * always deletes — the `CONTENT_BUG_SKIP_ERASURE` demo arms content, not donations.
 */
export function userErasedHandler(): EventHandler {
  return async (tx, payload) => {
    const evt = UserErasedEvent.parse(payload)
    await eraseUserData(tx, evt.user_id, evt.community_id)
  }
}

/**
 * Integration surface (NOT unit-tested — no broker in the test loop, mirroring the flag consumer).
 * Start the durable JetStream consumer that deletes a user's donations when identity emits
 * `user.erased`. Filtered to the erasure feed only. Returns a stop function.
 */
export async function startDonationsErasureConsumer(
  handle: NatsHandle,
  stream: string,
  db: DonationsDb,
  clock: Clock,
): Promise<() => Promise<void>> {
  const handler = userErasedHandler()
  return consumeDurable(
    handle,
    { stream, durable: ERASURE_SUBSCRIPTION, filterSubjects: [USER_ERASED_FEED_SUBJECT] },
    {
      spanName: 'nats.process',
      loopDeathSpanName: 'nats.donations.erasure.loop_died',
      traceCarrier: (message) => headersToRecord(message.headers),
      handle: async (message) => {
        const meta = readEventHeaders(headersToRecord(message.headers))
        await processEvent(
          db,
          ERASURE_SUBSCRIPTION,
          {
            eventId: meta.eventId,
            communityId: meta.communityId,
            payload: message.json<unknown>(),
          },
          handler,
          clock,
        )
        message.ack()
      },
      settle: (message) =>
        settleByDeliveryBudget(message, {
          max: ERASURE_CONSUMER_MAX_DELIVERIES,
          poisonReason: 'donations erasure consumer poison: exhausted delivery budget',
        }),
    },
  )
}
