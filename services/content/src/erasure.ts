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
import type { ContentDb } from './db/client'
import type { FaultConfig } from './deps'

/** Durable consumer + dedup subscription name for the GDPR erasure cascade (ADR-0036). */
export const ERASURE_SUBSCRIPTION = 'content-on-user-erased'

/** Poison threshold: after this many attempts a `user.erased` is dead-lettered, not redelivered forever. */
export const ERASURE_CONSUMER_MAX_DELIVERIES = 5

/**
 * Delete content-service's slice of a user within ONE community (the GDPR erasure cascade, ADR-0036):
 * the user's votes on any post in that community (votes carry no `community_id`, so scope via the
 * post) and the user's own posts in that community. Returns how many rows were deleted. Idempotent —
 * re-running it deletes nothing the second time, which (with the `processed_events` dedup) is what
 * makes a redelivered erasure a no-op.
 */
export async function eraseUserData(
  tx: SqlExecutor,
  userId: string,
  communityId: string,
): Promise<number> {
  const deletedVotes = rowsOf(
    await tx.execute(sql`
      DELETE FROM votes
      WHERE voter_id = ${userId}
        AND post_id IN (SELECT id FROM posts WHERE community_id = ${communityId})
      RETURNING voter_id
    `),
  )
  const deletedPosts = rowsOf(
    await tx.execute(sql`
      DELETE FROM posts WHERE author_id = ${userId} AND community_id = ${communityId} RETURNING id
    `),
  )
  return deletedVotes.length + deletedPosts.length
}

/**
 * Count content-service's footprint for a user across every community: posts they authored plus votes
 * they cast. The `user-erased-everywhere` claim asserts this is 0 after the saga settles — if content's
 * handler was skipped (`CONTENT_BUG_SKIP_ERASURE`), it stays > 0 and the property reds.
 */
export async function countUserFootprint(db: SqlExecutor, userId: string): Promise<number> {
  const res = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM posts WHERE author_id = ${userId})
      + (SELECT count(*) FROM votes WHERE voter_id = ${userId}) AS n
  `)
  const rows = rowsOf<{ n: number | string }>(res)
  return Number(rows[0]?.n ?? 0)
}

/**
 * The `user.erased` consumer effect (dedup + tenant scope handled by `processEvent`). The pure handler
 * is unit-tested directly with no broker. `CONTENT_BUG_SKIP_ERASURE` (the `skipErasure` fault) acks the
 * event WITHOUT deleting — the deliberate-bug demo behind the `user-erased-everywhere` claim.
 */
export function userErasedHandler(faults: FaultConfig): EventHandler {
  return async (tx, payload) => {
    const evt = UserErasedEvent.parse(payload)
    if (faults.skipErasure) return
    await eraseUserData(tx, evt.user_id, evt.community_id)
  }
}

/**
 * Integration surface (NOT unit-tested — no broker in the test loop, mirroring the donations flag
 * consumer and the webhooks fan-out). Start the durable JetStream consumer that deletes a user's
 * content slice when identity emits `user.erased`. Filtered to the erasure feed only. Restores trace
 * context, dedups via `processEvent`, and settles by delivery budget (nak → redeliver, then term).
 * Returns a stop function.
 */
export async function startContentErasureConsumer(
  handle: NatsHandle,
  stream: string,
  db: ContentDb,
  clock: Clock,
  faults: FaultConfig,
): Promise<() => Promise<void>> {
  const handler = userErasedHandler(faults)
  return consumeDurable(
    handle,
    { stream, durable: ERASURE_SUBSCRIPTION, filterSubjects: [USER_ERASED_FEED_SUBJECT] },
    {
      spanName: 'nats.process',
      loopDeathSpanName: 'nats.content.erasure.loop_died',
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
          poisonReason: 'content erasure consumer poison: exhausted delivery budget',
        }),
    },
  )
}
