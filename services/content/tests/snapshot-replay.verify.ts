import assert from 'node:assert/strict'
import { EXAMPLE_COMMUNITY_ID, EXAMPLE_USER_ID, LamportGate } from '@qaroom/contracts'
import { pgSnapshotStore } from '@qaroom/messaging'
import { FakeClock, SeededIdGenerator, SeededRandomness } from '@qaroom/testing-utils/determinism'
import { injectClient } from '@qaroom/testing-utils/harness'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { sql as drizzleSql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { buildApp } from '../src/app'
import { ensureSchema } from '../src/db/migrate'
import { schema } from '../src/db/schema'
import type { FaultConfig } from '../src/deps'
import { asContentDb } from './db-cast'

/**
 * The Milestone-7 regression catalog (Commitment 8): ≥3 scenarios that run on every PR (Docker
 * tier — the store is postgres-js, not pglite). Also the live-against-real-Postgres proof of the
 * capture/restore loop.
 *   1. feed-order-bug — the deliberate-bug demo: reproduce under the bug, green after the fix.
 *   2. full-state-fidelity — posts + votes round-trip exactly (state counts, feed, lamport).
 *   3. empty-restore — restoring an empty capture wipes a dirtied DB (truncation works).
 *   4. plumbing-reset — restore clears the idempotency cache so a reused env serves no stale reply.
 *   5. evomaster-idempotency-conflict — a black-box-fuzzing find (M8) reified deterministically.
 *   6. bulk-restore — a snapshot whose posts table exceeds Postgres's 65534 bind-param cap in a
 *      single multi-row INSERT must still restore (chunked); a seam-A find against a gauntlet-sized
 *      bundle, where a 6MB content capture 413'd, then 500'd, then MAX_PARAMETERS_EXCEEDED'd.
 */
const COMMUNITY = EXAMPLE_COMMUNITY_ID
const AUTHOR = EXAMPLE_USER_ID
const FEED = `/api/communities/${COMMUNITY}/feed`

const container = await new PostgreSqlContainer('postgres:18-alpine').start()
const sql = postgres(container.getConnectionUri(), { max: 4 })
const db = asContentDb(drizzle(sql, { schema }))
await ensureSchema(db)

const clock = new FakeClock('2026-06-04T00:00:00.000Z')
const ids = new SeededIdGenerator(1)
const lamport = new LamportGate(ids)
const store = pgSnapshotStore(sql)
// Mutable fault set flipped mid-process by scenarioFeedOrderBug (read per call by listFeed) — the
// injectable replacement for the old process.env mutation, so this script touches no global state.
const faults: FaultConfig = {
  feedReversed: false,
  tenantLeak: false,
  voteSlowMs: 0,
  syncPublish: false,
}
const app = buildApp({
  db,
  clock,
  ids,
  randomness: new SeededRandomness(1),
  lamport,
  snapshotStore: store,
  faults,
})
const request = injectClient(app)

const titles = (body: unknown): string[] =>
  (body as { posts: { title: string }[] }).posts.map((p) => p.title)
const feedLamport = (body: unknown): number =>
  (body as { as_of: { lamport: number } }).as_of.lamport

let postCounter = 0
async function seedPost(title: string): Promise<string> {
  postCounter += 1
  const res = await request.post(
    `/api/communities/${COMMUNITY}/posts`,
    { author_id: AUTHOR, title, body: 'b' },
    { 'idempotency-key': `seed-${postCounter}` },
  )
  clock.advance(1000)
  return (res.json as { id: string }).id
}

async function clearDomain(): Promise<void> {
  await db.execute(drizzleSql`TRUNCATE posts, votes CASCADE`)
}

async function scenarioFeedOrderBug(): Promise<void> {
  await clearDomain()
  faults.feedReversed = true
  for (let i = 0; i < 3; i += 1) await seedPost(`post-${i}`)
  const buggy = (await request.get(FEED)).json
  const buggyTitles = titles(buggy)
  assert.deepEqual(buggyTitles, ['post-0', 'post-1', 'post-2'], 'bug sorts oldest-first')
  const buggyLamport = feedLamport(buggy)

  const snapshot = (await request.get('/system/snapshot')).json
  await seedPost('dirty') // dirty the DB
  const restore1 = await request.post('/system/snapshot', snapshot)
  assert.equal(restore1.status, 200, `restore failed: ${JSON.stringify(restore1.json)}`)
  const reproduced = (await request.get(FEED)).json
  assert.deepEqual(titles(reproduced), buggyTitles, 'restore reproduces the captured order')
  assert.equal(feedLamport(reproduced), buggyLamport, 'restore reproduces as_of.lamport')

  faults.feedReversed = false
  await request.post('/system/snapshot', snapshot)
  const fixed = (await request.get(FEED)).json
  assert.deepEqual(titles(fixed), [...buggyTitles].reverse(), 'fix replays green (newest-first)')
}

async function scenarioFullStateFidelity(): Promise<void> {
  await clearDomain()
  const postId = await seedPost('with-votes')
  await seedPost('another')
  await request.post(
    `/api/posts/${postId}/votes`,
    { voter_id: AUTHOR, value: 1 },
    { 'idempotency-key': 'vote-1' },
  )
  const before = (await request.get('/system/state')).json as {
    models: { posts: { count: number }; votes: { count: number } }
  }
  const snapshot = (await request.get('/system/snapshot')).json
  await seedPost('dirty') // dirty
  await request.post('/system/snapshot', snapshot)
  const after = (await request.get('/system/state')).json as typeof before
  assert.deepEqual(after.models, before.models, 'post + vote counts round-trip exactly')
}

const idempotencyRows = async (): Promise<number> =>
  (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM idempotency_responses`)[0]?.n ?? 0

async function scenarioPlumbingReset(): Promise<void> {
  await clearDomain()
  await seedPost('cached') // a keyed mutation writes an idempotency_responses row
  const before = await idempotencyRows()
  const snapshot = (await request.get('/system/snapshot')).json
  await request.post('/system/snapshot', snapshot)
  const after = await idempotencyRows()
  assert.ok(before >= 1, 'a seeded mutation cached an idempotency response')
  assert.equal(
    after,
    0,
    'restore resets the idempotency cache, so a reused env serves no stale reply',
  )
}

async function scenarioEmptyRestore(): Promise<void> {
  await clearDomain()
  const empty = (await request.get('/system/snapshot')).json // capture an empty content
  await seedPost('leftover')
  await seedPost('leftover-2')
  await request.post('/system/snapshot', empty) // restoring empty must wipe the dirtied rows
  const state = (await request.get('/system/state')).json as {
    models: { posts: { count: number } }
  }
  assert.equal(state.models.posts.count, 0, 'restoring an empty snapshot truncates the DB')
}

async function scenarioEvomasterIdempotencyConflict(): Promise<void> {
  // EvoMaster v6 (black-box search, Milestone 8) reused an Idempotency-Key with a DIFFERENT body on
  // createPost and hit a 409 the OpenAPI spec did not declare (fault type 101 — undocumented response
  // status). Schemathesis never reaches this: it sends a single static key, so the conflict branch is
  // invisible to schema-driven fuzzing. Reified here as a deterministic regression — same key + a
  // different body must return the RFC 7807 conflict envelope. Provenance:
  // services/content/tests/evomaster-generated/EvoMaster_faults_Test.js (regenerated each nightly run).
  await clearDomain()
  const key = 'evomaster-conflict'
  const first = await request.post(
    `/api/communities/${COMMUNITY}/posts`,
    { author_id: AUTHOR, title: 'Why deterministic clocks matter', body: 'A short note.' },
    { 'idempotency-key': key },
  )
  assert.equal(first.status, 201, `first create should be 201, got ${first.status}`)
  const conflict = await request.post(
    `/api/communities/${COMMUNITY}/posts`,
    { author_id: AUTHOR, title: 'A different title', body: 'A different body.' },
    { 'idempotency-key': key },
  )
  assert.equal(
    conflict.status,
    409,
    `reused key + different body should be 409, got ${conflict.status}`,
  )
  const problem = conflict.json as { type: string; failure_domain: string; retryable: boolean }
  assert.equal(problem.failure_domain, 'conflict', 'failure_domain is conflict')
  assert.equal(
    problem.type,
    'https://qaroom.dev/errors/idempotency-key-conflict',
    'carries the RFC 7807 conflict type',
  )
  assert.equal(problem.retryable, false, 'an idempotency conflict is not retryable')
}

async function scenarioBulkRestore(): Promise<void> {
  await clearDomain()
  // posts has 7 columns, so >9362 rows would blow the 65534 bind-param cap in ONE multi-row
  // INSERT (the pre-fix restore did exactly that and 500'd). Seed past the cap directly in SQL
  // (the HTTP path is too slow for 10k posts), capture, dirty, restore — the chunked insert must
  // succeed and round-trip every row.
  const N = 12_000
  await sql`
    INSERT INTO posts (id, community_id, author_id, title, body, score, created_at)
    SELECT
      'post_' || lpad(g::text, 26, '0'),
      ${COMMUNITY}, ${AUTHOR}, 'bulk-' || g, 'b', 0,
      timestamptz '2026-06-04T00:00:00.000Z' + (g * interval '1 second')
    FROM generate_series(1, ${N}) AS g`
  const captured = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM posts`)[0]?.n ?? 0
  assert.equal(captured, N, `seeded ${N} posts`)

  const snapshot = (await request.get('/system/snapshot')).json
  await clearDomain() // dirty: empty it
  const restore = await request.post('/system/snapshot', snapshot)
  assert.equal(restore.status, 200, `bulk restore failed: ${JSON.stringify(restore.json)}`)
  const restored = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM posts`)[0]?.n ?? 0
  assert.equal(
    restored,
    N,
    'every row past the bind-param cap round-trips through the chunked insert',
  )
}

let failed = false
try {
  await scenarioFeedOrderBug()
  process.stdout.write(
    '✓ scenario 1 feed-order-bug: reproduced under the bug, green after the fix\n',
  )
  await scenarioFullStateFidelity()
  process.stdout.write('✓ scenario 2 full-state-fidelity: posts + votes round-trip exactly\n')
  await scenarioEmptyRestore()
  process.stdout.write('✓ scenario 3 empty-restore: restoring an empty capture wipes the DB\n')
  await scenarioPlumbingReset()
  process.stdout.write('✓ scenario 4 plumbing-reset: restore clears the idempotency cache\n')
  await scenarioEvomasterIdempotencyConflict()
  process.stdout.write(
    '✓ scenario 5 evomaster-idempotency-conflict: reused key + different body → RFC 7807 409\n',
  )
  await scenarioBulkRestore()
  process.stdout.write(
    '✓ scenario 6 bulk-restore: a snapshot past the 65534 bind-param cap restores chunked\n',
  )
} catch (err) {
  failed = true
  process.stderr.write(`✗ snapshot-replay regression failed: ${String(err)}\n`)
} finally {
  await app.close()
  await sql.end()
  await container.stop()
}

process.exit(failed ? 1 : 0)
