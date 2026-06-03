import { PGlite } from '@electric-sql/pglite'
import { COMM_GENERAL, composeMigrations, PostCreatedEvent } from '@qaroom/contracts'
import { createPostRequestArb } from '@qaroom/testing-utils/generators'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MESSAGING_MIGRATIONS } from './migrations'
import { type EventHandler, processEvent } from './subscribe'
import { rowsOf, type SqlExecutor, type TxRunner } from './types'

const clock = { now: () => new Date('2026-06-03T00:00:00.000Z') }
const COMM_A = COMM_GENERAL
const COMM_B = 'comm_00000000000000000000000001'

async function freshMessagingDb(): Promise<SqlExecutor & TxRunner> {
  const db = drizzle(new PGlite()) as unknown as SqlExecutor & TxRunner
  await composeMigrations(MESSAGING_MIGRATIONS).up(db)
  return db
}

// Payloads are drawn from the committed spec (the `PostCreatedEvent` Zod schema, via the
// repo's `createPostRequestArb`) — the achievable in-process slice of the async fuzz gap
// that no OSS NATS tool fills (ADR-0011). `event_id` is assigned by index so a duplicate
// re-delivers the SAME event (no same-id/different-payload), and every event is delivered
// twice to force the dedup path.
const eventsArb = fc
  .array(fc.tuple(createPostRequestArb, fc.constantFrom(COMM_A, COMM_B)), {
    minLength: 1,
    maxLength: 8,
  })
  .map((entries) =>
    entries.map(([body, community], index) =>
      PostCreatedEvent.parse({
        event_id: `evt_${String(index).padStart(26, '0')}`,
        post_id: 'post_00000000000000000000000000',
        community_id: community,
        author_id: body.author_id,
        title: body.title,
        body: body.body,
        created_at: '2026-06-03T00:00:00.000Z',
      }),
    ),
  )

describe('the consumer survives the spec-drawn payload space (in-process async property)', () => {
  it('never throws on a valid event, stays idempotent under duplicates, and never crosses tenants', async () => {
    await fc.assert(
      fc.asyncProperty(eventsArb, async (events) => {
        const db = await freshMessagingDb()
        await db.execute(
          sql`CREATE TABLE projection (event_id text PRIMARY KEY, community_id text NOT NULL)`,
        )
        // Representative handler: re-parse the event off the wire (the oracle, in code),
        // then write a per-event projection row. The INSERT has no ON CONFLICT, so a
        // dedup failure would surface as a primary-key violation, not a silent overcount.
        const handler: EventHandler = async (tx, payload) => {
          const event = PostCreatedEvent.parse(payload)
          await tx.execute(
            sql`INSERT INTO projection (event_id, community_id) VALUES (${event.event_id}, ${event.community_id})`,
          )
        }
        for (const event of [...events, ...events]) {
          await processEvent(
            db,
            'projection-sub',
            { eventId: event.event_id, communityId: event.community_id, payload: event },
            handler,
            clock,
          )
        }
        const rows = rowsOf<{ event_id: string; community_id: string }>(
          await db.execute(sql`SELECT event_id, community_id FROM projection`),
        )
        const expectedCommunity = new Map(events.map((e) => [e.event_id, e.community_id]))
        expect(rows).toHaveLength(events.length)
        for (const row of rows) {
          expect(row.community_id).toBe(expectedCommunity.get(row.event_id))
        }
      }),
      { numRuns: 20 },
    )
  })
})
