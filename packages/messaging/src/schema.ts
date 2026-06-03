import { integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Transactional outbox (Commitment 17): the event row is written in the SAME transaction
 * as the business write; the relay drains unpublished rows to JetStream using the row's
 * stable `id` as the `Nats-Msg-Id`. `trace_context` is the W3C carrier captured at enqueue,
 * so the relay's PRODUCER span links to the originating request trace. The DDL mirror lives
 * in `migrations.ts` (the source of truth the services apply).
 */
export const outbox = pgTable('outbox', {
  id: text('id').primaryKey(),
  subject: text('subject').notNull(),
  eventName: text('event_name').notNull(),
  eventVersion: integer('event_version').notNull(),
  communityId: text('community_id').notNull(),
  payload: jsonb('payload').notNull(),
  traceContext: jsonb('trace_context').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
})

/**
 * Per-subscription consumer dedup (Commitment 17): the consumer records each processed
 * `event_id` in the SAME transaction as its effects; a second delivery of the same id is
 * skipped. The contract is `(Nats-Msg-Id window) + (this table)`, not the window alone.
 */
export const processedEvents = pgTable(
  'processed_events',
  {
    subscriptionName: text('subscription_name').notNull(),
    eventId: text('event_id').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.subscriptionName, t.eventId] })],
)

/**
 * Idempotency-Key replay store (Commitment 4), shared so every mutating service applies
 * the SAME shape rather than each re-declaring it.
 */
export const idempotencyResponses = pgTable(
  'idempotency_responses',
  {
    idempotencyKey: text('idempotency_key').notNull(),
    route: text('route').notNull(),
    bodyHash: text('body_hash').notNull(),
    status: integer('status').notNull(),
    responseBody: jsonb('response_body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.idempotencyKey, t.route, t.bodyHash] })],
)
