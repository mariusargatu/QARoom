import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asContentDb } from '../tests/db-cast'
import { NO_FAULTS } from './config/faults'
import type { ContentDb } from './db/client'
import { ensureSchema } from './db/migrate'
import { countUserFootprint, eraseUserData, userErasedHandler } from './erasure'

const WHEN = '2026-01-01T00:00:00.000Z'
const USER = 'user_00000000000000000000000001'
const OTHER = 'user_00000000000000000000000002'
const C1 = 'comm_00000000000000000000000001'
const C2 = 'comm_00000000000000000000000002'

let pglite: PGlite
let db: ContentDb

async function seed(): Promise<void> {
  await db.execute(sql`
    INSERT INTO posts (id, community_id, author_id, title, body, score, created_at) VALUES
      ('post_a', ${C1}, ${USER}, 't', 'b', 0, ${WHEN}::timestamptz),
      ('post_b', ${C2}, ${USER}, 't', 'b', 0, ${WHEN}::timestamptz),
      ('post_c', ${C1}, ${OTHER}, 't', 'b', 0, ${WHEN}::timestamptz)
  `)
  await db.execute(sql`
    INSERT INTO votes (post_id, voter_id, value, created_at) VALUES
      ('post_a', ${USER}, 1, ${WHEN}::timestamptz),
      ('post_c', ${USER}, 1, ${WHEN}::timestamptz),
      ('post_a', ${OTHER}, 1, ${WHEN}::timestamptz)
  `)
}

beforeEach(async () => {
  pglite = new PGlite()
  db = asContentDb(drizzle(pglite))
  await ensureSchema(db)
  await seed()
})

afterEach(async () => {
  await pglite.close()
})

describe('content erasure', () => {
  it('countUserFootprint counts a user’s posts and votes across communities', async () => {
    expect(await countUserFootprint(db, USER)).toBe(4)
    expect(await countUserFootprint(db, OTHER)).toBe(2)
  })

  it('eraseUserData deletes the user’s posts and votes scoped to one community', async () => {
    const deleted = await eraseUserData(db, USER, C1)
    // C1: post_a (authored) + votes on post_a and post_c (both in C1) = 3.
    expect(deleted).toBe(3)
    // post_b (C2) and its absence of votes remain; the user still has a C2 footprint.
    expect(await countUserFootprint(db, USER)).toBe(1)
  })

  it('eraseUserData leaves another user’s data untouched', async () => {
    await eraseUserData(db, USER, C1)
    await eraseUserData(db, USER, C2)
    expect(await countUserFootprint(db, OTHER)).toBe(2)
  })

  it('the handler deletes when the skipErasure fault is off', async () => {
    const handler = userErasedHandler(NO_FAULTS)
    await handler(db, {
      event_id: 'evt_00000000000000000000000009',
      user_id: USER,
      community_id: C1,
      requested_at: WHEN,
    })
    expect(await countUserFootprint(db, USER)).toBe(1)
  })

  it('the handler is a no-op (acks without deleting) when skipErasure is armed', async () => {
    const handler = userErasedHandler({ ...NO_FAULTS, skipErasure: true })
    await handler(db, {
      event_id: 'evt_00000000000000000000000009',
      user_id: USER,
      community_id: C1,
      requested_at: WHEN,
    })
    expect(await countUserFootprint(db, USER)).toBe(4)
  })
})
