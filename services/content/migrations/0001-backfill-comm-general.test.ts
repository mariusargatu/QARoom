import { PGlite } from '@electric-sql/pglite'
import { COMM_GENERAL, CommunityId, type Migration } from '@qaroom/contracts'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asContentDb } from '../tests/db-cast'
import type { ContentDb } from '../src/db/client'
import { backfillCommGeneral } from '../src/db/backfill'
import { ensureSchema } from '../src/db/migrate'
import { posts } from '../src/db/schema'

/**
 * Migration discipline (docs/05): up → down → up → up(no-op) with structural assertions
 * at each step (NO snapshots). The Milestone-2 backfill normalizes any non-branded
 * community_id to the reserved general community and is reversible via an audit table.
 * A sibling test demonstrates the exit criterion "a migration whose `down` does not
 * reverse the `up` fails the reversibility assertion".
 */
const VALID_A = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD'
const VALID_B = 'comm_01HZY0K7M3QF8VN2J5RX9TB4AA'
const SENTINELS = ['', 'default', 'general', 'legacy', 'comm_not_a_valid_ulid'] as const
const WHEN = new Date('2026-01-01T00:00:00.000Z')

let pglite: PGlite
let db: ContentDb

async function seedPosts(communityIds: readonly string[]): Promise<void> {
  await db.insert(posts).values(
    communityIds.map((cid, i) => ({
      id: `post_01HZY0K7M3QF8VN2J5RX9TB${String(i).padStart(3, '0')}`,
      communityId: cid,
      authorId: 'user_01HZY0K7M3QF8VN2J5RX9TB4CF',
      title: 'seeded',
      body: 'seeded',
      score: 0,
      createdAt: WHEN,
    })),
  )
}

const communityIds = async (): Promise<string[]> =>
  (await db.select({ cid: posts.communityId }).from(posts)).map((r) => r.cid)

const countOf = (cids: string[], value: string): number => cids.filter((c) => c === value).length

const auditExists = async (): Promise<boolean> => {
  const res = await db.execute(sql`SELECT to_regclass('migration_backfill_audit') AS t`)
  const rows = (res as unknown as { rows: Array<{ t: string | null }> }).rows
  return rows[0]?.t != null
}

beforeEach(async () => {
  pglite = new PGlite()
  db = asContentDb(drizzle(pglite))
  await ensureSchema(db)
})

afterEach(async () => {
  await pglite.close()
})

describe('content backfill migration (0001 backfill-comm-general)', () => {
  it('rewrites every non-branded community_id to the general community and leaves valid ids untouched', async () => {
    await seedPosts([VALID_A, VALID_B, ...SENTINELS])
    await backfillCommGeneral.up(db)
    const cids = await communityIds()
    expect(cids.every((c) => CommunityId.safeParse(c).success)).toBe(true)
    expect(countOf(cids, COMM_GENERAL)).toBe(SENTINELS.length)
    expect(countOf(cids, VALID_A)).toBe(1)
    expect(countOf(cids, VALID_B)).toBe(1)
  })

  it('reverses cleanly: down restores the original community_id of every rewritten row and drops the audit table', async () => {
    await seedPosts([VALID_A, ...SENTINELS])
    await backfillCommGeneral.up(db)
    expect(await auditExists()).toBe(true)
    await backfillCommGeneral.down(db)
    const cids = await communityIds()
    expect(countOf(cids, COMM_GENERAL)).toBe(0)
    expect(countOf(cids, '')).toBe(1)
    expect(countOf(cids, 'default')).toBe(1)
    expect(countOf(cids, VALID_A)).toBe(1)
    expect(await auditExists()).toBe(false)
  })

  it('is reproducible and idempotent: up after a down→up cycle and a second up yield an identical end state', async () => {
    await seedPosts([VALID_A, ...SENTINELS])
    await backfillCommGeneral.up(db)
    const afterFirstUp = (await communityIds()).slice().sort()
    await backfillCommGeneral.down(db)
    await backfillCommGeneral.up(db)
    const afterReUp = (await communityIds()).slice().sort()
    await backfillCommGeneral.up(db)
    const afterNoOpUp = (await communityIds()).slice().sort()
    expect(afterReUp).toEqual(afterFirstUp)
    expect(afterNoOpUp).toEqual(afterFirstUp)
    expect(countOf(afterNoOpUp, COMM_GENERAL)).toBe(SENTINELS.length)
  })

  it('catches a deliberately broken migration whose down does not reverse the up', async () => {
    const broken: Migration<ContentDb> = {
      name: 'broken-no-down',
      up: backfillCommGeneral.up,
      async down() {
        /* deliberately a no-op: this is the bug the reversibility assertion must catch */
      },
    }
    await seedPosts(['legacy'])
    await broken.up(db)
    await broken.down(db)
    const cids = await communityIds()
    // A correct down would restore 'legacy'; the broken one leaves it as the general community.
    expect(countOf(cids, 'legacy')).toBe(0)
    expect(countOf(cids, COMM_GENERAL)).toBe(1)
  })
})
