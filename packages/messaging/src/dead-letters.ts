import { sql } from 'drizzle-orm'
import { rowsOf, type SqlExecutor } from './types'

/**
 * The durable landing place for a message the delivery budget gave up on.
 *
 * `settleByDeliveryBudget` calls JetStream's `term()` once a message has been delivered `max`
 * times, which tells the broker to STOP redelivering. There was no dead-letter stream, no
 * `$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES` subscriber, no `max_deliver` on the consumer, no
 * metric and no test that anything survived — `settle.test.ts` asserted only that `term` was
 * called. Five consumers use that policy, so a `user.erased` whose handler failed through a
 * transient DB outage was discarded permanently, under a README line reading "never lost".
 *
 * A row here is not a fix for the failure that poisoned the message; it is the difference between
 * a loss you can find and replay, and one nobody ever learns about. Deliberately NOT swept by
 * `gcDedup`: dedup rows are hygiene, dead letters are evidence.
 */
export interface DeadLetter {
  /** The durable consumer that gave up, so two consumers poisoning one event stay distinct. */
  subscriptionName: string
  /** The event's own `evt_<ulid>`, the same id used as `Nats-Msg-Id`. */
  eventId: string
  subject: string
  /** How many delivery attempts were made before the budget was exhausted. */
  deliveryCount: number
  /** The poison reason the consumer passed to `term()`, verbatim. */
  reason: string
  /** The event body, stored verbatim so it can be replayed once the cause is fixed. */
  payload: unknown
  /** JetStream stream sequence: the discriminator when the message carried no Nats-Msg-Id. */
  streamSequence: number
  /** From the injected clock — never `new Date()` (Commitment 6). */
  at: Date
}

/**
 * Record a poisoned message. Idempotent on (subscription, event): a consumer that somehow poisons
 * the same event twice updates the row rather than accumulating, while a DIFFERENT consumer
 * poisoning the same event gets its own row (each has its own delivery budget and its own loss).
 */
export async function recordDeadLetter(db: SqlExecutor, letter: DeadLetter): Promise<void> {
  // An absent event id must NOT dedupe against another absent one: fall back to the stream
  // sequence, which is unique per message.
  const dedupeKey = letter.eventId !== '' ? letter.eventId : `seq:${letter.streamSequence}`
  await db.execute(sql`
    INSERT INTO dead_letters
      (subscription_name, event_id, dedupe_key, subject, delivery_count, reason, payload, recorded_at)
    VALUES
      (${letter.subscriptionName}, ${letter.eventId}, ${dedupeKey}, ${letter.subject},
       ${letter.deliveryCount}, ${letter.reason}, ${JSON.stringify(letter.payload)}::jsonb,
       ${letter.at.toISOString()}::timestamptz)
    ON CONFLICT (subscription_name, dedupe_key) DO UPDATE SET
      event_id = EXCLUDED.event_id,
      subject = EXCLUDED.subject,
      delivery_count = EXCLUDED.delivery_count,
      reason = EXCLUDED.reason,
      payload = EXCLUDED.payload,
      recorded_at = EXCLUDED.recorded_at
  `)
}

/** Every recorded dead letter, for an operator view or a test assertion. */
export async function deadLetterRows(db: SqlExecutor): Promise<
  Array<{
    subscription_name: string
    event_id: string
    subject: string
    delivery_count: number
    reason: string
  }>
> {
  const result = await db.execute(sql`
    SELECT subscription_name, event_id, subject, delivery_count, reason
    FROM dead_letters ORDER BY subscription_name, event_id
  `)
  return rowsOf(result) as Array<{
    subscription_name: string
    event_id: string
    subject: string
    delivery_count: number
    reason: string
  }>
}

/** How many messages this service has given up on. Non-zero is an incident, not a statistic. */
export async function deadLetterCount(db: SqlExecutor): Promise<number> {
  const result = await db.execute(sql`SELECT COUNT(*)::int AS n FROM dead_letters`)
  return (rowsOf(result)[0] as { n?: number } | undefined)?.n ?? 0
}

/**
 * The one-line `onPoison` every consumer wires: persist the poisoned message to `dead_letters`.
 * Owned here so five consumers cannot each record a different subset of the event, the way they
 * previously each hand-rolled the settle policy before `settle.ts` centralised it.
 */
export function deadLetterSink(
  db: SqlExecutor,
  subscriptionName: string,
  clock: { now(): Date },
): (poisoned: {
  deliveryCount: number
  reason: string
  subject: string
  eventId: string
  payload: unknown
  streamSequence: number
}) => Promise<void> {
  return async (poisoned) => {
    await recordDeadLetter(db, {
      subscriptionName,
      eventId: poisoned.eventId,
      subject: poisoned.subject,
      deliveryCount: poisoned.deliveryCount,
      reason: poisoned.reason,
      payload: poisoned.payload,
      streamSequence: poisoned.streamSequence,
      at: clock.now(),
    })
  }
}
