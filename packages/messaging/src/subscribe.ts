import type { Clock } from '@qaroom/determinism'
import { withTenant } from '@qaroom/otel'
import { alreadyProcessed, markProcessed } from './dedup'
import type { SqlExecutor, TxRunner } from './types'

/** A consumer handler: applies an event's effects within the provided transaction. */
export type EventHandler = (tx: SqlExecutor, payload: unknown) => Promise<void>

export interface DeliveredEvent {
  eventId: string
  communityId: string
  payload: unknown
}

/**
 * Process one delivered event with exactly-once *effects* over at-least-once delivery
 * (Commitment 17): in a single transaction — skip if already processed, else run the
 * handler and record the event id. The handler runs inside `withTenant` so its spans carry
 * `tenant.id`. This is the dedup core; the duplicate-delivery property exercises it with no
 * broker in the loop, which is exactly why that property is cheap and deterministic.
 */
export async function processEvent(
  db: TxRunner,
  subscriptionName: string,
  event: DeliveredEvent,
  handler: EventHandler,
  clock: Clock,
): Promise<{ skipped: boolean }> {
  // CHAOS_SKIP_DEDUP is the experiment-03 deliberate-bug toggle: when set, the dedup check +
  // record are bypassed, so a redelivered event re-applies its effect. Off in all normal
  // operation (and every unit test), so the dedup invariant is unchanged outside the demo.
  const skipDedup = process.env.CHAOS_SKIP_DEDUP === '1'
  return db.transaction(async (tx) => {
    if (!skipDedup && (await alreadyProcessed(tx, subscriptionName, event.eventId))) {
      return { skipped: true }
    }
    await withTenant(event.communityId, () => handler(tx, event.payload))
    if (!skipDedup) await markProcessed(tx, subscriptionName, event.eventId, clock.now())
    return { skipped: false }
  })
}
