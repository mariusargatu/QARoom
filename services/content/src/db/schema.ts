import { voteValueCheckSql } from '@qaroom/contracts'
import { idempotencyResponses } from '@qaroom/messaging/schema'
import { sql } from 'drizzle-orm'
import { check, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * content-service persistence. `community_id` is the tenancy discriminator
 * (Commitment 9 seam) even though communities-as-tenants land in Milestone 2.
 * Branded IDs are stored as their prefixed-ULID text form.
 */
export const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  communityId: text('community_id').notNull(),
  authorId: text('author_id').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  score: integer('score').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

export const votes = pgTable(
  'votes',
  {
    postId: text('post_id').notNull(),
    voterId: text('voter_id').notNull(),
    // The ±1 invariant lives at the database boundary, not just in the request schema: the CHECK
    // predicate is DERIVED from contracts' VOTE_VALUES (voteValueCheckSql), so a `7` cannot enter
    // the table even if some future caller bypasses the Zod parse — and `score = sum(value)` can
    // therefore only ever equal (upvotes − downvotes). One rule, enforced at the real boundary.
    value: integer('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.voterId] }),
    check('votes_value_check', sql.raw(voteValueCheckSql('value'))),
  ],
)

// idempotency_responses is the shared @qaroom/messaging table (one shape across services).
export const schema = { posts, votes, idempotencyResponses }
