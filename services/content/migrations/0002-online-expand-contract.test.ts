import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asContentDb } from '../tests/db-cast'
import type { ContentDb } from '../src/db/client'
import { ensureSchema } from '../src/db/migrate'

/**
 * Online expand/contract migration safety (T14, ADR-0036) against a POPULATED table — the column-level
 * companion to the table-level discipline harness (up/down/idempotent). The exit criterion is
 * zero-downtime evolution of a 10k-row table through the three-phase pattern, each step a NON-blocking
 * form (never a table rewrite, never an ACCESS EXCLUSIVE scan against readers):
 *
 *   EXPAND   ADD COLUMN nullable, no default   → instant, no rewrite; existing rows read NULL.
 *   BACKFILL UPDATE ... WHERE col IS NULL       → batched in production; row locks only, reads proceed.
 *   CONTRACT ADD CONSTRAINT ... NOT VALID, then VALIDATE CONSTRAINT
 *                                               → the NOT VALID add is instant; VALIDATE scans WITHOUT
 *                                                 ACCESS EXCLUSIVE, so readers/writers are never blocked.
 *
 * The deliberately-AVOIDED form is `ALTER COLUMN ... SET NOT NULL`, which takes ACCESS EXCLUSIVE and
 * full-scans the table against readers. This test pins the safe shape: reads return the full row set at
 * every phase, the backfill touches all 10k rows, and the validated constraint then rejects a NULL.
 */

const ROW_COUNT = 10_000
const WHEN = '2026-01-01T00:00:00.000Z'
const CONSTRAINT = 'posts_content_format_not_null'

let pglite: PGlite
let db: ContentDb

async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const res = await db.execute(query)
  const rows = (res as unknown as { rows: Array<{ n: number | string }> }).rows
  return Number(rows[0]?.n ?? 0)
}

const totalPosts = (): Promise<number> => scalar(sql`SELECT count(*)::int AS n FROM posts`)
const nullFormats = (): Promise<number> =>
  scalar(sql`SELECT count(*)::int AS n FROM posts WHERE content_format IS NULL`)
const markdownFormats = (): Promise<number> =>
  scalar(sql`SELECT count(*)::int AS n FROM posts WHERE content_format = 'markdown'`)
const constraintValidated = (): Promise<number> =>
  scalar(sql`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = ${CONSTRAINT} AND convalidated`)

beforeEach(async () => {
  pglite = new PGlite()
  db = asContentDb(drizzle(pglite))
  await ensureSchema(db)
  // Seed 10k posts in one set-based insert (fast, deterministic) — the populated table the online
  // migration must evolve without locking the feed against readers.
  await db.execute(sql`
    INSERT INTO posts (id, community_id, author_id, title, body, score, created_at)
    SELECT 'post_' || lpad(g::text, 26, '0'),
           'comm_00000000000000000000000000',
           'user_00000000000000000000000000',
           't', 'b', 0, ${WHEN}::timestamptz
    FROM generate_series(1, ${ROW_COUNT}) AS g
  `)
})

afterEach(async () => {
  await pglite.close()
})

describe('content online expand/contract migration (0002) against 10k populated rows', () => {
  it('EXPAND adds a nullable column with no rewrite; every existing row reads and the new column is NULL', async () => {
    await db.execute(sql`ALTER TABLE posts ADD COLUMN content_format text`)
    // Reads are unaffected — the full row set is still returned.
    expect(await totalPosts()).toBe(ROW_COUNT)
    // No default given, so existing rows carry NULL (the column was added to the catalog, not rewritten).
    expect(await nullFormats()).toBe(ROW_COUNT)
  })

  it('BACKFILL fills all 10k rows, then CONTRACT enforces NOT NULL online and rejects a NULL insert', async () => {
    await db.execute(sql`ALTER TABLE posts ADD COLUMN content_format text`)
    // BACKFILL: in production this is range-batched; the discipline is WHERE col IS NULL so it is
    // restartable and idempotent. Reads proceed throughout (row locks only, never a table lock).
    await db.execute(sql`UPDATE posts SET content_format = 'markdown' WHERE content_format IS NULL`)
    expect(await nullFormats()).toBe(0)
    expect(await markdownFormats()).toBe(ROW_COUNT)

    // CONTRACT: the online NOT NULL — a CHECK added NOT VALID (instant), then VALIDATE (no ACCESS
    // EXCLUSIVE against readers). The deliberately-avoided form is ALTER COLUMN ... SET NOT NULL.
    await db.execute(
      sql.raw(
        `ALTER TABLE posts ADD CONSTRAINT ${CONSTRAINT} CHECK (content_format IS NOT NULL) NOT VALID`,
      ),
    )
    await db.execute(sql.raw(`ALTER TABLE posts VALIDATE CONSTRAINT ${CONSTRAINT}`))
    expect(await constraintValidated()).toBe(1)
    expect(await totalPosts()).toBe(ROW_COUNT)
  })

  it('after CONTRACT, a row violating NOT NULL is rejected; a conforming row is accepted', async () => {
    await db.execute(sql`ALTER TABLE posts ADD COLUMN content_format text`)
    await db.execute(sql`UPDATE posts SET content_format = 'markdown' WHERE content_format IS NULL`)
    await db.execute(
      sql.raw(
        `ALTER TABLE posts ADD CONSTRAINT ${CONSTRAINT} CHECK (content_format IS NOT NULL) NOT VALID`,
      ),
    )
    await db.execute(sql.raw(`ALTER TABLE posts VALIDATE CONSTRAINT ${CONSTRAINT}`))

    await db.execute(sql`
      INSERT INTO posts (id, community_id, author_id, title, body, score, created_at, content_format)
      VALUES ('post_conforms', 'comm_00000000000000000000000000', 'user_00000000000000000000000000', 't', 'b', 0, ${WHEN}::timestamptz, 'markdown')
    `)
    expect(await totalPosts()).toBe(ROW_COUNT + 1)
  })

  it('rejects an out-of-discipline NULL insert once the constraint is validated', async () => {
    await db.execute(sql`ALTER TABLE posts ADD COLUMN content_format text`)
    await db.execute(sql`UPDATE posts SET content_format = 'markdown' WHERE content_format IS NULL`)
    await db.execute(
      sql.raw(
        `ALTER TABLE posts ADD CONSTRAINT ${CONSTRAINT} CHECK (content_format IS NOT NULL) NOT VALID`,
      ),
    )
    await db.execute(sql.raw(`ALTER TABLE posts VALIDATE CONSTRAINT ${CONSTRAINT}`))

    await expect(
      db.execute(sql`
        INSERT INTO posts (id, community_id, author_id, title, body, score, created_at, content_format)
        VALUES ('post_violates', 'comm_00000000000000000000000000', 'user_00000000000000000000000000', 't', 'b', 0, ${WHEN}::timestamptz, NULL)
      `),
    ).rejects.toThrow()
  })

  it('CONTRACT reverses cleanly: dropping the constraint and column restores the original shape', async () => {
    await db.execute(sql`ALTER TABLE posts ADD COLUMN content_format text`)
    await db.execute(sql`UPDATE posts SET content_format = 'markdown' WHERE content_format IS NULL`)
    await db.execute(
      sql.raw(
        `ALTER TABLE posts ADD CONSTRAINT ${CONSTRAINT} CHECK (content_format IS NOT NULL) NOT VALID`,
      ),
    )
    await db.execute(sql.raw(`ALTER TABLE posts VALIDATE CONSTRAINT ${CONSTRAINT}`))

    await db.execute(sql.raw(`ALTER TABLE posts DROP CONSTRAINT ${CONSTRAINT}`))
    await db.execute(sql`ALTER TABLE posts DROP COLUMN content_format`)
    expect(await constraintValidated()).toBe(0)
    expect(await totalPosts()).toBe(ROW_COUNT)
  })
})
