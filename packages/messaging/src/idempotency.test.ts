import { PGlite } from '@electric-sql/pglite'
import { composeMigrations } from '@qaroom/contracts'
import { drizzle } from 'drizzle-orm/pglite'
import { describe, expect, it } from 'vitest'
import { bodyHash, conflictingIdempotencyKey, findIdempotent, storeIdempotent } from './idempotency'
import { MESSAGING_MIGRATIONS } from './migrations'
import type { SqlExecutor } from './types'

const NOW = new Date('2026-06-04T00:00:00.000Z')
const KEY = 'idem-key-1'
const ROUTE = 'POST /api/communities/{communityId}/posts'

async function freshDb(): Promise<SqlExecutor> {
  const db = drizzle(new PGlite()) as unknown as SqlExecutor
  await composeMigrations(MESSAGING_MIGRATIONS).up(db)
  return db
}

describe('bodyHash is stable under key reordering', () => {
  it('hashes the same regardless of property order', () => {
    expect(bodyHash({ a: 1, b: 2, nested: { x: 1, y: 2 } })).toBe(
      bodyHash({ nested: { y: 2, x: 1 }, b: 2, a: 1 }),
    )
  })

  it('differs when any value differs', () => {
    expect(bodyHash({ a: 1 })).not.toBe(bodyHash({ a: 2 }))
  })
})

describe('the shared idempotency store replays exact matches and flags conflicts', () => {
  it('returns null before a write and the stored response after', async () => {
    const db = await freshDb()
    const hash = bodyHash({ n: 1 })
    expect(await findIdempotent(db, KEY, ROUTE, hash)).toBeNull()
    await storeIdempotent(
      db,
      { key: KEY, route: ROUTE, hash, status: 201, body: { id: 'post_x' } },
      NOW,
    )
    expect(await findIdempotent(db, KEY, ROUTE, hash)).toEqual({
      status: 201,
      body: { id: 'post_x' },
    })
  })

  it('flags the same key+route reused with a different body as a conflict', async () => {
    const db = await freshDb()
    const firstHash = bodyHash({ n: 1 })
    const otherHash = bodyHash({ n: 2 })
    await storeIdempotent(
      db,
      { key: KEY, route: ROUTE, hash: firstHash, status: 201, body: {} },
      NOW,
    )
    expect(await conflictingIdempotencyKey(db, KEY, ROUTE, otherHash)).toBe(true)
    expect(await conflictingIdempotencyKey(db, KEY, ROUTE, firstHash)).toBe(false)
  })
})
