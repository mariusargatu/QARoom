import { test } from '@fast-check/vitest'
import {
  LamportGate,
  VOTE_CAST_EVENT,
  VOTE_CAST_VERSION,
  VOTE_VALUES,
  VoteValue,
  type VoteValueT,
  voteCast,
} from '@qaroom/contracts'
import { voteValueArb } from '@qaroom/testing-utils/generators'
import { pgliteRows, type RepoTest, setupRepoTest } from '@qaroom/testing-utils/harness'
import { sql } from 'drizzle-orm'
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NO_FAULTS, resolveFaults } from '../config/faults'
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

  it('the injected vote-slow fault adds latency to the write path but leaves the result correct', async () => {
    const post = await newPost()
    // A small fixed delay arms the SLO-regression branch; the recomputed score and the single
    // stored votes row must be exactly as on the no-delay path — the fault changes timing, not state.
    const slowDeps: RepoDeps = { ...deps, faults: { ...NO_FAULTS, voteSlowMs: 5 } }
    expect(await castVote(ctx.db, slowDeps, post.id, VOTER, 1)).toBe(1)
    expect(await voteRowCount(post.id)).toBe(1)
  })

  it('the injected out-of-range fault writes a ±7 value and the DB CHECK rejects it (the ±1 falsifier)', async () => {
    const post = await newPost()
    // voteOutOfRange multiplies the validated ±1 by 7; the votes_value_check CONSTRAINT (derived from
    // contracts' VOTE_VALUES) must reject the write at the table boundary — the empirical falsifier for
    // the vote-value-in-band claim. The transaction aborts, so no out-of-band row can ever persist.
    const buggyDeps: RepoDeps = { ...deps, faults: { ...NO_FAULTS, voteOutOfRange: true } }
    await expect(castVote(ctx.db, buggyDeps, post.id, VOTER, 1)).rejects.toThrow()
    expect(await voteRowCount(post.id)).toBe(0)
  })

  it('rejects an out-of-set vote value (0) by set membership, where a range projection would admit it', async () => {
    // The C6 finding (ADR-0033): VOTE_VALUES projected as a RANGE [-1, 1] would ADMIT 0; projected as
    // a SET {1, -1} — the votes_value_check IN-clause, derived from VOTE_VALUES — REJECTS it. Projection
    // choice is a severity decision, which is why `prove --break` must be adversarial. Pure contrast
    // first, then the real falsifier armed via env (CONTENT_BUG_VOTE_OUT_OF_SET): castVote writes 0,
    // the set-membership CHECK rejects it, the insert throws — the teeth for the `vote-value-in-set` claim.
    const min = Math.min(...VOTE_VALUES)
    const max = Math.max(...VOTE_VALUES)
    expect(0 >= min && 0 <= max).toBe(true) // a RANGE falsifier MISSES the adversary 0
    expect((VOTE_VALUES as readonly number[]).includes(0)).toBe(false) // the SET falsifier CATCHES it

    const envDeps: RepoDeps = {
      clock: ctx.clock,
      ids: ctx.ids,
      lamport: new LamportGate(ctx.ids),
      faults: resolveFaults(),
    }
    const post = await createPost(ctx.db, envDeps, {
      communityId: COMMUNITY,
      authorId: AUTHOR,
      title: 'votable',
      body: 'b',
    })
    // Clean: a legal +1 stores and scores 1. Armed (CONTENT_BUG_VOTE_OUT_OF_SET): castVote writes 0,
    // the set-membership DB CHECK rejects it, the insert throws, and this success expectation reds.
    const score = await castVote(ctx.db, envDeps, post.id, VOTER, 1)
    expect(score).toBe(1)
    expect(await voteRowCount(post.id)).toBe(1)
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

  it('on a NET-NEGATIVE score, the vote.cast event carries the SIGNED score (== persisted posts.score), not its magnitude', async () => {
    // Three distinct downvotes drive the post net-negative: score == -3. The single +1 exemplar
    // above cannot tell `score: vote.score` apart from `score: Math.abs(vote.score)` — both yield 1.
    // A negative score is the oracle that pins the sign: the published score must equal the score
    // persisted on the post row (the `tx.update(posts).set({ score })` write path), which is -3.
    const post = await newPost()
    let lastScore: number | null = null
    for (const voter of NET_NEGATIVE_VOTERS) {
      lastScore = await castVote(ctx.db, deps, post.id, voter, -1)
    }
    expect(lastScore).toBe(-3)

    const persisted = await pgliteRows<{ score: number }>(
      ctx.db,
      sql`SELECT score FROM posts WHERE id = ${post.id}`,
    )
    const persistedScore = persisted[0]?.score ?? Number.NaN
    expect(persistedScore).toBe(-3)

    // The last staged vote.cast event is the third (score -3); its wire score must match the row.
    const published = await pgliteRows<{ score: number }>(
      ctx.db,
      sql`SELECT (payload->>'score')::int AS score FROM outbox
          WHERE event_name = ${VOTE_CAST_EVENT} ORDER BY id DESC LIMIT 1`,
    )
    const publishedScore = published[0]?.score ?? Number.NaN
    expect(publishedScore).toBe(persistedScore)
    expect(publishedScore).toBe(-3)
  })
})

// Three distinct voters so a net-negative score (-3) is reachable; ±1 keeps each vote in-band.
const NET_NEGATIVE_VOTERS = [
  'user_01HZY0K7M3QF8VN2J5RX9TB411',
  'user_01HZY0K7M3QF8VN2J5RX9TB412',
  'user_01HZY0K7M3QF8VN2J5RX9TB413',
] as const

// Three voters, drawn by index so a sequence can change a voter's mind (last write wins).
const VOTERS = [
  'user_01HZY0K7M3QF8VN2J5RX9TB401',
  'user_01HZY0K7M3QF8VN2J5RX9TB402',
  'user_01HZY0K7M3QF8VN2J5RX9TB403',
] as const

/**
 * The ±1 invariant as a real property over the REAL `castVote` + the REAL DB CHECK (votes_value_check
 * runs in PGlite, the same Postgres engine as prod). Co-located in this file (rather than a separate
 * `*.property.test.ts`) on purpose: `pnpm test` caps worker concurrency at 50% of cores and the
 * PGlite-heavy property suites sit at the timeout edge under full fan-out (root AGENTS.md), so reusing
 * this file's per-test PGlite adds no extra concurrent worker. Each run votes on a FRESH post (votes
 * are keyed by post_id + voter_id, so runs never interfere) and asserts together:
 *
 *   1. every stored vote value parses under `VoteValue` (∈ ±1) — the table cannot hold a 7;
 *   2. the returned score reconciles: `score == upvotes − downvotes`;
 *   3. `|score| <= distinct voters` — a corollary that only holds because (1) does.
 *
 * `voteValueArb` is DERIVED from `VOTE_VALUES`; assertion (1) cross-checks every drawn value against
 * `VoteValue.parse`, so the arbitrary cannot drift from the schema. A separate `deps` with
 * `resolveFaults()` (not the suite's NO_FAULTS) lets `CONTENT_BUG_VOTE_OUT_OF_RANGE` arm via env:
 * `castVote` then writes an out-of-range value, the DB CHECK rejects it, and this property goes red —
 * the falsifier for the `vote-value-in-band` claim.
 */
describe('vote value ±1 invariant + score reconciliation (property)', () => {
  test.prop(
    [
      fc.array(fc.record({ voter: fc.nat({ max: VOTERS.length - 1 }), value: voteValueArb }), {
        minLength: 1,
        maxLength: 5,
      }),
    ],
    // Modest run count: the TOTAL ±1 guarantee is the DB CHECK (structural, every row); this property
    // only corroborates the score-reconciliation corollary on a sample. Co-located in votes.test.ts
    // (not a new *.property.test.ts) so it adds no extra concurrent PGlite worker — `pnpm test` caps
    // concurrency at 50% of cores and the PGlite property suites sit at the timeout edge under full
    // fan-out (root AGENTS.md), most visibly on a cold-cache run right after editing shared packages.
    { numRuns: 10 },
  )(
    'a vote value is always +1 or -1 and the score reconciles to upvotes minus downvotes',
    async (ops: { voter: number; value: VoteValueT }[]) => {
      // Env-aware deps so the deliberate-bug toggle arms; ctx (PGlite) comes from this suite's beforeEach.
      const envDeps: RepoDeps = {
        clock: ctx.clock,
        ids: ctx.ids,
        lamport: new LamportGate(ctx.ids),
        faults: resolveFaults(),
      }
      const post = await createPost(ctx.db, envDeps, {
        communityId: COMMUNITY,
        authorId: AUTHOR,
        title: 'votable',
        body: 'b',
      })

      const finalByVoter = new Map<number, VoteValueT>()
      let lastScore: number | null = null
      for (const op of ops) {
        const voter = VOTERS[op.voter] ?? VOTERS[0]
        lastScore = await castVote(ctx.db, envDeps, post.id, voter, op.value)
        finalByVoter.set(op.voter, op.value)
      }

      // (1) every stored value is a legal ±1 — straight from the table, scoped to this run's post.
      const stored = await pgliteRows<{ value: number }>(
        ctx.db,
        sql`SELECT value FROM votes WHERE post_id = ${post.id}`,
      )
      for (const row of stored) {
        expect(VoteValue.parse(row.value)).toBe(row.value)
      }

      // (2) score reconciliation: expected derived purely from the input sequence, not the SUT.
      const expectedScore = [...finalByVoter.values()].reduce((acc, v) => acc + v, 0)
      expect(lastScore).toBe(expectedScore)

      // (3) the PERSISTED post.score reconciles too — a real SUT value on a different write path than
      // castVote's return (`tx.update(posts).set({ score })`), and it stays bounded by |voters|.
      const persisted = await pgliteRows<{ score: number }>(
        ctx.db,
        sql`SELECT score FROM posts WHERE id = ${post.id}`,
      )
      const storedScore = persisted[0]?.score ?? Number.NaN
      expect(storedScore).toBe(expectedScore)
      expect(Math.abs(storedScore)).toBeLessThanOrEqual(finalByVoter.size)
    },
  )
})
