import { PGlite } from '@electric-sql/pglite'
import { composeMigrations } from '@qaroom/contracts'
import { drizzle } from 'drizzle-orm/pglite'
import { describe, expect, it } from 'vitest'
import {
  bodyHash,
  claimIdempotent,
  completeIdempotent,
  conflictingIdempotencyKey,
  findIdempotent,
  releaseIdempotent,
} from './idempotency'
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
    await claimIdempotent(db, { key: KEY, route: ROUTE, hash }, NOW)
    // An unfinished claim is a reservation, not a response — it must not replay as one.
    expect(await findIdempotent(db, KEY, ROUTE, hash)).toBeNull()
    await completeIdempotent(
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
    await claimIdempotent(db, { key: KEY, route: ROUTE, hash: firstHash }, NOW)
    await completeIdempotent(
      db,
      { key: KEY, route: ROUTE, hash: firstHash, status: 201, body: {} },
      NOW,
    )
    expect(await conflictingIdempotencyKey(db, KEY, ROUTE, otherHash)).toBe(true)
    expect(await conflictingIdempotencyKey(db, KEY, ROUTE, firstHash)).toBe(false)
  })
})

describe('the claim is the arbiter: exactly one caller may run the guarded effect', () => {
  it('admits the first claimer and reports every later one as in flight', async () => {
    const db = await freshDb()
    const hash = bodyHash({ n: 1 })
    expect(await claimIdempotent(db, { key: KEY, route: ROUTE, hash }, NOW)).toBe('claimed')
    expect(await claimIdempotent(db, { key: KEY, route: ROUTE, hash }, NOW)).toBe('in_flight')
  })

  it('reports a finished claim as completed so the caller replays instead of re-running', async () => {
    const db = await freshDb()
    const hash = bodyHash({ n: 1 })
    await claimIdempotent(db, { key: KEY, route: ROUTE, hash }, NOW)
    await completeIdempotent(db, { key: KEY, route: ROUTE, hash, status: 201, body: {} }, NOW)
    expect(await claimIdempotent(db, { key: KEY, route: ROUTE, hash }, NOW)).toBe('completed')
  })

  it('frees the key when a released claim is retried (a failed attempt must not burn it)', async () => {
    const db = await freshDb()
    const hash = bodyHash({ n: 1 })
    await claimIdempotent(db, { key: KEY, route: ROUTE, hash }, NOW)
    await releaseIdempotent(db, KEY, ROUTE, hash)
    expect(await claimIdempotent(db, { key: KEY, route: ROUTE, hash }, NOW)).toBe('claimed')
  })

  it('never releases a COMPLETED response (release is scoped to in-flight claims)', async () => {
    const db = await freshDb()
    const hash = bodyHash({ n: 1 })
    await claimIdempotent(db, { key: KEY, route: ROUTE, hash }, NOW)
    await completeIdempotent(db, { key: KEY, route: ROUTE, hash, status: 201, body: { a: 1 } }, NOW)
    await releaseIdempotent(db, KEY, ROUTE, hash)
    expect(await findIdempotent(db, KEY, ROUTE, hash)).toEqual({ status: 201, body: { a: 1 } })
  })

  it('takes over a claim left stranded by a dead process, once it is stale', async () => {
    const db = await freshDb()
    const hash = bodyHash({ n: 1 })
    await claimIdempotent(db, { key: KEY, route: ROUTE, hash }, NOW)
    const muchLater = new Date(NOW.getTime() + 120_000)
    expect(await claimIdempotent(db, { key: KEY, route: ROUTE, hash }, muchLater)).toBe('claimed')
  })

  it('does not steal a claim that is still within the stale window', async () => {
    const db = await freshDb()
    const hash = bodyHash({ n: 1 })
    await claimIdempotent(db, { key: KEY, route: ROUTE, hash }, NOW)
    const shortlyAfter = new Date(NOW.getTime() + 1_000)
    expect(await claimIdempotent(db, { key: KEY, route: ROUTE, hash }, shortlyAfter)).toBe(
      'in_flight',
    )
  })
})
