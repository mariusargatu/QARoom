import { PGlite } from '@electric-sql/pglite'
import { composeMigrations } from '@qaroom/contracts'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MESSAGING_MIGRATIONS } from './migrations'
import { type EventHandler, processEvent } from './subscribe'
import { rowsOf, type SqlExecutor, type TxRunner } from './types'

const clock = { now: () => new Date('2026-06-03T00:00:00.000Z') }
const COMM = 'comm_00000000000000000000000000'

async function freshMessagingDb(): Promise<SqlExecutor & TxRunner> {
  const db = drizzle(new PGlite()) as unknown as SqlExecutor & TxRunner
  await composeMigrations(MESSAGING_MIGRATIONS).up(db)
  return db
}

// A small pool of ids so the generated sequences are dense with duplicates.
const deliveriesArb = fc.array(fc.constantFrom('evt_a', 'evt_b', 'evt_c', 'evt_d', 'evt_e'), {
  minLength: 1,
  maxLength: 20,
})

describe('duplicate delivery produces no observable double-effect (Commitment 17)', () => {
  it('applies a non-idempotent handler exactly once per distinct event id, whatever the duplicates', async () => {
    await fc.assert(
      fc.asyncProperty(deliveriesArb, async (eventIds) => {
        const db = await freshMessagingDb()
        await db.execute(sql`CREATE TABLE tally (k text PRIMARY KEY, n integer NOT NULL DEFAULT 0)`)
        await db.execute(sql`INSERT INTO tally (k, n) VALUES ('p', 0)`)
        // Deliberately NON-idempotent: correctness rests on processed_events, not the
        // handler. Removing markProcessed in dedup.ts makes this property fail (the
        // Milestone-4 dedup deliberate-bug demonstration).
        const handler: EventHandler = async (tx) => {
          await tx.execute(sql`UPDATE tally SET n = n + 1 WHERE k = 'p'`)
        }
        for (const eventId of eventIds) {
          await processEvent(
            db,
            'tally-sub',
            { eventId, communityId: COMM, payload: {} },
            handler,
            clock,
          )
        }
        const n = rowsOf<{ n: number }>(await db.execute(sql`SELECT n FROM tally WHERE k = 'p'`))[0]
          ?.n
        expect(n).toBe(new Set(eventIds).size)
      }),
      { numRuns: 20 },
    )
  })

  it('reports the second delivery of an event id as skipped', async () => {
    const db = await freshMessagingDb()
    const noop: EventHandler = async () => {}
    const first = await processEvent(
      db,
      'sub',
      { eventId: 'evt_x', communityId: COMM, payload: {} },
      noop,
      clock,
    )
    const second = await processEvent(
      db,
      'sub',
      { eventId: 'evt_x', communityId: COMM, payload: {} },
      noop,
      clock,
    )
    expect(first.skipped).toBe(false)
    expect(second.skipped).toBe(true)
  })
})
