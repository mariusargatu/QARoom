import { PGlite } from '@electric-sql/pglite'
import { asServiceDb } from '@qaroom/testing-utils/harness'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DonationsDb } from './db/client'
import { ensureSchema } from './db/migrate'
import { countUserFootprint, eraseUserData, userErasedHandler } from './erasure'

const WHEN = '2026-01-01T00:00:00.000Z'
const USER = 'user_00000000000000000000000001'
const OTHER = 'user_00000000000000000000000002'
const C1 = 'comm_00000000000000000000000001'
const C2 = 'comm_00000000000000000000000002'

let pglite: PGlite
let db: DonationsDb

async function seed(): Promise<void> {
  await db.execute(sql`
    INSERT INTO donations (id, community_id, donor_id, amount_cents, currency, status, created_at, updated_at) VALUES
      ('dntn_a', ${C1}, ${USER}, 500, 'usd', 'succeeded', ${WHEN}::timestamptz, ${WHEN}::timestamptz),
      ('dntn_b', ${C2}, ${USER}, 700, 'usd', 'succeeded', ${WHEN}::timestamptz, ${WHEN}::timestamptz),
      ('dntn_c', ${C1}, ${OTHER}, 900, 'usd', 'succeeded', ${WHEN}::timestamptz, ${WHEN}::timestamptz)
  `)
}

beforeEach(async () => {
  pglite = new PGlite()
  db = asServiceDb<DonationsDb>(drizzle(pglite))
  await ensureSchema(db)
  await seed()
})

afterEach(async () => {
  await pglite.close()
})

describe('donations erasure', () => {
  it('countUserFootprint counts a user’s donations across communities', async () => {
    expect(await countUserFootprint(db, USER)).toBe(2)
    expect(await countUserFootprint(db, OTHER)).toBe(1)
  })

  it('eraseUserData deletes the user’s donations scoped to one community', async () => {
    const deleted = await eraseUserData(db, USER, C1)
    expect(deleted).toBe(1)
    expect(await countUserFootprint(db, USER)).toBe(1)
  })

  it('the handler deletes the user’s donations and leaves another user untouched', async () => {
    const handler = userErasedHandler()
    await handler(db, {
      event_id: 'evt_00000000000000000000000009',
      user_id: USER,
      community_id: C1,
      requested_at: WHEN,
    })
    expect(await countUserFootprint(db, USER)).toBe(1)
    expect(await countUserFootprint(db, OTHER)).toBe(1)
  })
})
