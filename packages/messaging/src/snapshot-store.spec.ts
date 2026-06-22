import type { Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { pgSnapshotStore } from './snapshot-store'
import {
  createSnapshotSchema,
  resetAll,
  type SnapshotPgFixture,
  setupSnapshotPg,
} from './snapshot-store.testkit'

// Integration spec for the Commitment-8 snapshot store against a REAL Postgres (postgres-js wire),
// the one seam PGlite cannot host. Gated on QAROOM_PG_TESTS + Docker (see the testkit); skips
// cleanly otherwise, so the fast unit lane stays Docker-free.
const fx = await setupSnapshotPg()
const sql = fx?.sql as Sql

describe.skipIf(!fx)('pgSnapshotStore against real Postgres', () => {
  beforeAll(async () => {
    await createSnapshotSchema(sql)
  })

  afterAll(async () => {
    await (fx as SnapshotPgFixture).stop()
  })

  beforeEach(async () => {
    await resetAll(sql)
    await sql`INSERT INTO post ${sql([{ id: 'post_1', title: 'hello', score: 3 }])}`
    await sql`INSERT INTO vote ${sql([{ id: 'vote_1', post_id: 'post_1', value: 1 }])}`
  })

  it('captures only domain base tables, never the plumbing or the excluded set', async () => {
    await sql`INSERT INTO idempotency_responses ${sql([{ key: 'k', body: { ok: true } }])}`
    await sql`INSERT INTO signing_keys ${sql([{ kid: 'key_1', d: 'secret' }])}`
    const store = pgSnapshotStore(sql, { exclude: ['signing_keys'] })

    const snap = await store.capture()

    expect(Object.keys(snap).sort()).toEqual(['post', 'vote'])
    expect(snap.post).toHaveLength(1)
    expect(snap.vote).toHaveLength(1)
  })

  it('round-trips domain rows: a mutated database restores to the captured state', async () => {
    const store = pgSnapshotStore(sql, { exclude: ['signing_keys'] })
    const snap = await store.capture()

    await sql`UPDATE post SET title = 'tampered', score = 99 WHERE id = 'post_1'`
    await sql`INSERT INTO post ${sql([{ id: 'post_2', title: 'extra', score: 0 }])}`
    await store.restore(snap)

    const posts = await sql`SELECT id, title, score FROM post ORDER BY id`
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ id: 'post_1', title: 'hello', score: 3 })
  })

  it('resets a plumbing table on restore so a reused env serves no stale idempotent reply', async () => {
    const store = pgSnapshotStore(sql, { exclude: ['signing_keys'] })
    const snap = await store.capture()

    await sql`INSERT INTO idempotency_responses ${sql([{ key: 'k', body: { stale: true } }])}`
    await store.restore(snap)

    const left = await sql`SELECT count(*)::int AS n FROM idempotency_responses`
    expect(left[0]?.n).toBe(0)
  })

  it('never truncates an excluded table on restore (private key material survives)', async () => {
    await sql`INSERT INTO signing_keys ${sql([{ kid: 'key_1', d: 'secret' }])}`
    const store = pgSnapshotStore(sql, { exclude: ['signing_keys'] })
    const snap = await store.capture()

    await store.restore(snap)

    const keys = await sql`SELECT count(*)::int AS n FROM signing_keys`
    expect(keys[0]?.n).toBe(1)
  })

  it('refuses a restore whose table set differs from this schema (skew guard)', async () => {
    const store = pgSnapshotStore(sql, { exclude: ['signing_keys'] })
    await expect(store.restore({ post: [] })).rejects.toThrow(/schema mismatch/)
  })

  it('restores a row count that drives the bulk-insert chunk loop', async () => {
    await resetAll(sql)
    const many = Array.from({ length: 250 }, (_, i) => ({
      id: `post_${i}`,
      title: `t${i}`,
      score: i,
    }))
    await sql`INSERT INTO post ${sql(many)}`
    const store = pgSnapshotStore(sql, { exclude: ['signing_keys'] })
    const snap = await store.capture()

    await sql`TRUNCATE post CASCADE`
    await store.restore(snap)

    const count = await sql`SELECT count(*)::int AS n FROM post`
    expect(count[0]?.n).toBe(250)
  })
})
