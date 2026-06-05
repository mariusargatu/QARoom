import { idempotencyResponses } from '@qaroom/messaging/schema'
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * webhooks-service persistence (Milestone 11).
 *
 * `webhook_subscriptions` holds each community's registered outbound endpoints (with the
 * write-once signing `secret`). `webhook_deliveries` is the durable work ledger: one row per
 * (subscription × source event), driven by the delivery worker to a terminal state. The ledger
 * IS the at-least-once work queue — there is NO `outbox` (webhooks publishes nothing, ADR-0019).
 * `idempotency_responses` (from @qaroom/messaging) backs the CRUD Idempotency-Key replay.
 */
export const webhookSubscriptions = pgTable('webhook_subscriptions', {
  id: text('id').primaryKey(),
  communityId: text('community_id').notNull(),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  eventTypes: text('event_types').array().notNull(),
  status: text('status').notNull(),
  consecutiveDeadLetters: integer('consecutive_dead_letters').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    subscriptionId: text('subscription_id').notNull(),
    communityId: text('community_id').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull(),
    attempt: integer('attempt').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastStatusCode: integer('last_status_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  // The per-target dedup boundary: one delivery per (subscription, event), even under redelivery.
  (t) => [uniqueIndex('webhook_deliveries_sub_event_idx').on(t.subscriptionId, t.eventId)],
)

export const schema = { webhookSubscriptions, webhookDeliveries, idempotencyResponses }
