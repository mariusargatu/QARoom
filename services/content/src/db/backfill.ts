import { COMM_GENERAL, CommunityId, type Migration, runMigration } from '@qaroom/contracts'
import type { Clock } from '@qaroom/determinism'
import { sql } from 'drizzle-orm'
import type { ContentDb } from './client'
import { posts } from './schema'

/**
 * Milestone 2 backfill (communities-as-tenants). Milestone-0 posts were inserted with
 * whatever `community_id` the caller supplied; M2 normalizes any value that is not a
 * well-formed branded `CommunityId` to the reserved general community (ADR-0007).
 *
 * Reversible: prior values are recorded in `migration_backfill_audit` before the rewrite,
 * so `down` restores them exactly. The forward step is idempotent — once a row is the
 * general community it matches the branded pattern and is never touched again.
 */
export { COMM_GENERAL }

/**
 * Representative legacy placeholders this backfill catches. NOT used directly in SQL —
 * the single sentinel test is "does not parse as a branded CommunityId", expressed as the
 * regex below — but each of these fails that regex, so they are all normalized.
 */
export const LEGACY_SENTINELS = ['', 'default', 'general', 'legacy'] as const

/** The branded-CommunityId pattern as a SQL regex — the independent second source vs CommunityId.parse(). */
const COMM_PATTERN = '^comm_[0-9A-HJKMNP-TV-Z]{26}$'

export const backfillCommGeneral: Migration<ContentDb> = {
  name: 'backfill-comm-general',
  async up(db) {
    await db.execute(
      sql.raw(
        `CREATE TABLE IF NOT EXISTS migration_backfill_audit (
          post_id text PRIMARY KEY,
          prev_community_id text NOT NULL
        )`,
      ),
    )
    // Record prior values for the rows about to be rewritten (skip already-audited → idempotent).
    await db.execute(sql`
      INSERT INTO migration_backfill_audit (post_id, prev_community_id)
      SELECT id, community_id FROM posts WHERE community_id !~ ${COMM_PATTERN}
      ON CONFLICT (post_id) DO NOTHING
    `)
    await db.execute(sql`
      UPDATE posts SET community_id = ${COMM_GENERAL} WHERE community_id !~ ${COMM_PATTERN}
    `)
  },
  async down(db) {
    await db.execute(sql`
      UPDATE posts SET community_id = a.prev_community_id
      FROM migration_backfill_audit a WHERE posts.id = a.post_id
    `)
    await db.execute(sql.raw('DROP TABLE IF EXISTS migration_backfill_audit'))
  },
}

/** True when every distinct post community_id parses through the branded CommunityId (exit criterion). */
async function allCommunityIdsParse(db: ContentDb): Promise<boolean> {
  const rows = await db.selectDistinct({ cid: posts.communityId }).from(posts)
  return rows.every((r) => CommunityId.safeParse(r.cid).success)
}

/**
 * Drive the backfill through the migration state machine: Pending → Backfilling (apply the
 * rewrite) → Verifying (every community_id parses) → Done. Run on boot after `ensureSchema`.
 */
export async function runContentBackfill(db: ContentDb, deps: { clock: Clock }): Promise<void> {
  await runMigration<ContentDb>(
    {
      tx: db,
      backfill: (tx) => backfillCommGeneral.up(tx),
      verify: (tx) => allCommunityIdsParse(tx),
    },
    { clock: deps.clock },
  )
}
