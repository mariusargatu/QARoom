import { idempotencyResponses } from '@qaroom/messaging/schema'
import { boolean, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * donations-service persistence (Milestone 5).
 *
 * `donations` holds each donation transaction. `flag_cache` is a local projection of the
 * `donations` feature flag's enabled state per community, maintained by a NATS consumer of
 * flags-service's `flag.state.changed` events — donation gating reads this cache instead of a
 * synchronous call to flags-service, so a donation can be gated even if flags-service is
 * momentarily unreachable.
 */
export const donations = pgTable('donations', {
  id: text('id').primaryKey(),
  communityId: text('community_id').notNull(),
  donorId: text('donor_id').notNull(),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

export const flagCache = pgTable(
  'flag_cache',
  {
    communityId: text('community_id').notNull(),
    flagKey: text('flag_key').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.communityId, t.flagKey] })],
)

export const schema = { donations, flagCache, idempotencyResponses }
