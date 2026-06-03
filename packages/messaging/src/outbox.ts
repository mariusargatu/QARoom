import { injectTraceContext } from '@qaroom/otel'
import { sql } from 'drizzle-orm'
import type { OutboxEvent, SqlExecutor } from './types'

/**
 * Write an event into the outbox in the SAME transaction as the business write
 * (transactional outbox, Commitment 17). The W3C trace carrier is captured HERE, under the
 * active request span, so the relay can restore it and link the PRODUCER span to the
 * originating trace. `id` is the event's `evt_<ulid>` — reused verbatim as the relay's
 * `Nats-Msg-Id`, so a relay restart republishes with the same id and JetStream dedups it
 * within the `duplicate_window`.
 */
export async function outboxPublish(tx: SqlExecutor, event: OutboxEvent, now: Date): Promise<void> {
  const traceContext = injectTraceContext({})
  await tx.execute(sql`
    INSERT INTO outbox
      (id, subject, event_name, event_version, community_id, payload, trace_context, created_at, published_at, attempts)
    VALUES
      (${event.eventId}, ${event.subject}, ${event.eventName}, ${event.eventVersion}, ${event.communityId},
       ${JSON.stringify(event.payload)}::jsonb, ${JSON.stringify(traceContext)}::jsonb, ${now.toISOString()}::timestamptz, NULL, 0)
  `)
}
