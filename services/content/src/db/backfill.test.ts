import { COMM_GENERAL, CommunityId } from '@qaroom/contracts'
import { setupRepoTest, type RepoTest } from '@qaroom/testing-utils/harness'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runContentBackfill } from './backfill'
import type { ContentDb } from './client'
import { ensureSchema } from './migrate'
import { posts } from './schema'

/**
 * Drives the FULL boot-time backfill entry point `runContentBackfill` (the migration state machine
 * Pending → Backfilling → Verifying → Done), which the raw up/down fragment test (migrations/0001)
 * never exercises. The verify predicate (every community_id parses) is the machine's exit gate.
 */
const AUTHOR = 'user_01HZY0K7M3QF8VN2J5RX9TB4CF'
const WHEN = new Date('2026-01-01T00:00:00.000Z')
const VALID = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD'

let ctx: RepoTest<ContentDb>

const seed = (communityIds: readonly string[]) =>
  ctx.db.insert(posts).values(
    communityIds.map((cid, i) => ({
      id: `post_01HZY0K7M3QF8VN2J5RX9TB${String(i).padStart(3, '0')}`,
      communityId: cid,
      authorId: AUTHOR,
      title: 'seeded',
      body: 'seeded',
      score: 0,
      createdAt: WHEN,
    })),
  )

const communityIds = async (): Promise<string[]> =>
  (await ctx.db.select({ cid: posts.communityId }).from(posts)).map((r) => r.cid)

beforeEach(async () => {
  ctx = await setupRepoTest<ContentDb>({ applyMigrations: (db) => ensureSchema(db) })
})

afterEach(async () => {
  await ctx.close()
})

describe('runContentBackfill (migration state machine)', () => {
  it('drives to Done, normalizing every non-branded community_id to the general community', async () => {
    await seed([VALID, 'legacy', '', 'default'])
    await runContentBackfill(ctx.db, { clock: ctx.clock })
    const cids = await communityIds()
    expect(cids.every((c) => CommunityId.safeParse(c).success)).toBe(true)
    expect(cids.filter((c) => c === COMM_GENERAL).length).toBe(3)
    expect(cids.filter((c) => c === VALID).length).toBe(1)
  })

  it('is idempotent: a second drive leaves the already-branded ids untouched', async () => {
    await seed([VALID, 'legacy'])
    await runContentBackfill(ctx.db, { clock: ctx.clock })
    const first = (await communityIds()).slice().sort()
    await runContentBackfill(ctx.db, { clock: ctx.clock })
    const second = (await communityIds()).slice().sort()
    expect(second).toEqual(first)
  })
})
