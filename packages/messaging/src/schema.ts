import { integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Idempotency-Key replay store (Commitment 4), shared so every mutating service applies
 * the SAME shape rather than each re-declaring it. This is the one table consumed as a Drizzle
 * model (5 services). The `outbox`/`processed_events` DDL has a single source of truth in
 * `migrations.ts`; their Drizzle mirrors were dead (every access is raw SQL) and were removed.
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
