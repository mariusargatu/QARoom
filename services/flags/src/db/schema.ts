import { idempotencyResponses } from '@qaroom/messaging/schema'
import { pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * flags-service persistence (Milestone 5). A flag's value per community is the current state
 * of the rollout machine; we store only that state name. The composite key `(community_id,
 * flag_key)` is the tenancy discriminator (Commitment 9) + the resource the advisory lock
 * serializes on. Absence of a row means the rollout is `Off` (the machine's initial state).
 */
export const flags = pgTable(
  'flags',
  {
    communityId: text('community_id').notNull(),
    flagKey: text('flag_key').notNull(),
    state: text('state').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.communityId, t.flagKey] })],
)

// idempotency_responses is the shared @qaroom/messaging table (one shape across services).
export const schema = { flags, idempotencyResponses }
