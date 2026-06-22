import {
  LamportGate,
  POST_CREATED_EVENT,
  POST_CREATED_VERSION,
  postCreated,
} from '@qaroom/contracts'
import { pgliteRows, type RepoTest, setupRepoTest } from '@qaroom/testing-utils/harness'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NO_FAULTS } from '../config/faults'
import type { ContentDb } from '../db/client'
import { ensureSchema } from '../db/migrate'
import type { RepoDeps } from '../deps'
import { createPost, getPost, listFeed } from './posts'

const COMMUNITY = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD'
const OTHER = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CE'
const AUTHOR = 'user_01HZY0K7M3QF8VN2J5RX9TB4CF'

interface OutboxRow {
  id: string
  subject: string
  event_name: string
  event_version: number
  community_id: string
  payload: Record<string, unknown>
}

let ctx: RepoTest<ContentDb>
let deps: RepoDeps

const outboxRows = () =>
  pgliteRows<OutboxRow>(
    ctx.db,
    sql`SELECT id, subject, event_name, event_version, community_id, payload FROM outbox ORDER BY created_at`,
  )

const seed = (input: { communityId: string; title: string }) =>
  createPost(ctx.db, deps, {
    communityId: input.communityId,
    authorId: AUTHOR,
    title: input.title,
    body: 'b',
  })

beforeEach(async () => {
  ctx = await setupRepoTest<ContentDb>({ applyMigrations: (db) => ensureSchema(db) })
  deps = {
    clock: ctx.clock,
    ids: ctx.ids,
    lamport: new LamportGate(ctx.ids),
    faults: { ...NO_FAULTS },
  }
})

afterEach(async () => {
  await ctx.close()
})

describe('repository/posts', () => {
  it('createPost stages a PostCreatedEvent on the outbox carrying the contract constants and payload', async () => {
    const post = await seed({ communityId: COMMUNITY, title: 'hello' })
    const rows = await outboxRows()
    expect(rows.length).toBe(1)
    const row = rows[0]
    expect(row?.subject).toBe(postCreated(COMMUNITY))
    expect(row?.event_name).toBe(POST_CREATED_EVENT)
    expect(row?.event_version).toBe(POST_CREATED_VERSION)
    expect(row?.community_id).toBe(COMMUNITY)
    expect(row?.payload.post_id).toBe(post.id)
    expect(row?.payload.title).toBe('hello')
    expect(row?.id.startsWith('evt_')).toBe(true)
  })

  it('getPost returns the created record and null for an unknown id', async () => {
    const post = await seed({ communityId: COMMUNITY, title: 'findable' })
    expect(await getPost(ctx.db, post.id)).toEqual(post)
    expect(await getPost(ctx.db, 'post_01HZY0K7M3QF8VN2J5RX9TB4ZZ')).toBeNull()
  })

  it('listFeed returns posts newest-first and honors a custom limit', async () => {
    for (const title of ['oldest', 'middle', 'newest']) {
      await seed({ communityId: COMMUNITY, title })
      ctx.clock.advance(1000)
    }
    const all = await listFeed(ctx.db, deps, COMMUNITY)
    expect(all.map((p) => p.title)).toEqual(['newest', 'middle', 'oldest'])
    const capped = await listFeed(ctx.db, deps, COMMUNITY, 2)
    expect(capped.map((p) => p.title)).toEqual(['newest', 'middle'])
  })

  it('listFeed caps at the default 50 even when more posts exist', async () => {
    await ctx.db.execute(sql`
      INSERT INTO posts (id, community_id, author_id, title, body, score, created_at)
      SELECT 'post_' || lpad(g::text, 26, '0'), ${COMMUNITY}, ${AUTHOR}, 'p' || g, 'b', 0,
        timestamptz '2026-06-04T00:00:00.000Z' + (g * interval '1 second')
      FROM generate_series(1, 51) AS g`)
    const feed = await listFeed(ctx.db, deps, COMMUNITY)
    expect(feed.length).toBe(50)
  })

  it('listFeed returns a stable total order for posts sharing a createdAt instant (PK tiebreak)', async () => {
    // Three posts at the SAME seeded instant — no clock.advance between them, so `createdAt` ties.
    // desc(createdAt) alone leaves the tie order unspecified (Postgres guarantees nothing); the
    // desc(id) tiebreak must pin newest-created-first. SeededIdGenerator mints ids monotonically,
    // so creation order is id-ascending and the deterministic newest-first order is its reverse.
    const created = []
    for (const title of ['first', 'second', 'third']) {
      created.push(await seed({ communityId: COMMUNITY, title }))
    }
    const expectedNewestFirst = [...created].reverse().map((p) => p.title)

    const once = await listFeed(ctx.db, deps, COMMUNITY)
    const twice = await listFeed(ctx.db, deps, COMMUNITY)
    // The exact total order (newest-created first at the tie), and it is reproducible across calls.
    expect(once.map((p) => p.title)).toEqual(expectedNewestFirst)
    expect(twice.map((p) => p.title)).toEqual(expectedNewestFirst)
  })

  it('the injected feed-reversed fault sorts the feed oldest-first instead of newest-first', async () => {
    for (const title of ['oldest', 'middle', 'newest']) {
      await seed({ communityId: COMMUNITY, title })
      ctx.clock.advance(1000)
    }
    const reversed = await listFeed(
      ctx.db,
      { ...deps, faults: { ...NO_FAULTS, feedReversed: true } },
      COMMUNITY,
    )
    // The regression demo flips the createdAt sort to ascending; the PK tiebreak stays desc(id).
    expect(reversed.map((p) => p.title)).toEqual(['oldest', 'middle', 'newest'])
  })

  it('listFeed is scoped to its community; the injected tenant-leak fault returns every tenant', async () => {
    await seed({ communityId: COMMUNITY, title: 'mine' })
    await seed({ communityId: OTHER, title: 'theirs' })
    const scoped = await listFeed(ctx.db, deps, COMMUNITY)
    expect(scoped.map((p) => p.title)).toEqual(['mine'])
    const leaky = await listFeed(
      ctx.db,
      { ...deps, faults: { ...NO_FAULTS, tenantLeak: true } },
      COMMUNITY,
    )
    expect(leaky.length).toBe(2)
  })
})
