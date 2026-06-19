import { LamportGate, VOTE_CAST_EVENT, VOTE_CAST_VERSION, voteCast } from '@qaroom/contracts'
import { pgliteRows, type RepoTest, setupRepoTest } from '@qaroom/testing-utils/harness'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NO_FAULTS } from '../config/faults'
import type { ContentDb } from '../db/client'
import { ensureSchema } from '../db/migrate'
import type { RepoDeps } from '../deps'
import { createPost } from './posts'
import { castVote } from './votes'

const COMMUNITY = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD'
const AUTHOR = 'user_01HZY0K7M3QF8VN2J5RX9TB4CF'
const VOTER = 'user_01HZY0K7M3QF8VN2J5RX9TB4CG'
const MISSING_POST = 'post_01HZY0K7M3QF8VN2J5RX9TB4ZZ'

interface VoteOutboxRow {
  subject: string
  event_name: string
  event_version: number
  payload: Record<string, unknown>
}

let ctx: RepoTest<ContentDb>
let deps: RepoDeps

const newPost = () =>
  createPost(ctx.db, deps, {
    communityId: COMMUNITY,
    authorId: AUTHOR,
    title: 'votable',
    body: 'b',
  })

const voteRowCount = async (postId: string): Promise<number> => {
  const rows = await pgliteRows<{ n: number }>(
    ctx.db,
    sql`SELECT count(*)::int AS n FROM votes WHERE post_id = ${postId}`,
  )
  return rows[0]?.n ?? 0
}

const voteEvents = () =>
  pgliteRows<VoteOutboxRow>(
    ctx.db,
    sql`SELECT subject, event_name, event_version, payload FROM outbox WHERE event_name = ${VOTE_CAST_EVENT}`,
  )

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

describe('repository/votes', () => {
  it('a voter changing their vote updates in place: +1 then -1 yields score -1 with a single votes row', async () => {
    const post = await newPost()
    expect(await castVote(ctx.db, deps, post.id, VOTER, 1)).toBe(1)
    expect(await castVote(ctx.db, deps, post.id, VOTER, -1)).toBe(-1)
    expect(await voteRowCount(post.id)).toBe(1)
  })

  it('castVote on a non-existent post returns null (the 404 signal, never a stored success)', async () => {
    expect(await castVote(ctx.db, deps, MISSING_POST, VOTER, 1)).toBeNull()
  })

  it('castVote stages a VoteCastEvent on the outbox carrying the recomputed score', async () => {
    const post = await newPost()
    await castVote(ctx.db, deps, post.id, VOTER, 1)
    const events = await voteEvents()
    expect(events.length).toBe(1)
    const event = events[0]
    expect(event?.subject).toBe(voteCast(COMMUNITY))
    expect(event?.event_version).toBe(VOTE_CAST_VERSION)
    expect(event?.payload.post_id).toBe(post.id)
    expect(event?.payload.score).toBe(1)
  })
})
