import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deadLetterRows, recordDeadLetter } from './dead-letters'
import { deadLettersMigration } from './migrations'
import type { SqlExecutor } from './types'

/**
 * The `term()` loss path. `settleByDeliveryBudget` terminates a message once its delivery budget is
 * exhausted, and until now there was NO dead-letter stream, no `$JS.EVENT` advisory subscriber, no
 * metric and no test that anything survived — `settle.test.ts` asserted only that `term` was
 * CALLED. Five consumers use it, so a `user.erased` whose handler failed through a transient DB
 * outage was discarded, silently, under a README line reading "never lost".
 *
 * These tests pin the durable half: a terminated message is written somewhere a human can find it
 * BEFORE the broker is told to stop redelivering.
 */
const AT = new Date('2026-07-27T12:00:00.000Z')

describe('recordDeadLetter makes a terminated message recoverable', () => {
  let pg: PGlite
  let db: SqlExecutor

  beforeEach(async () => {
    pg = new PGlite()
    db = drizzle(pg) as unknown as SqlExecutor
    await deadLettersMigration.up(db)
  })
  afterEach(async () => {
    await pg.close()
  })

  it('persists the event id, subject, subscription, reason and payload', async () => {
    await recordDeadLetter(db, {
      subscriptionName: 'content-on-user-erased',
      eventId: 'evt_01HZY0K7M3QF8VN2J5RX9TB4CM',
      subject: 'qaroom.identity.user.comm_1.erased',
      deliveryCount: 5,
      reason: 'content erasure consumer poison: exhausted delivery budget',
      payload: { user_id: 'user_1', community_id: 'comm_1' },
      streamSequence: 1,
      at: AT,
    })
    const rows = await deadLetterRows(db)
    expect(rows).toEqual([
      {
        subscription_name: 'content-on-user-erased',
        event_id: 'evt_01HZY0K7M3QF8VN2J5RX9TB4CM',
        subject: 'qaroom.identity.user.comm_1.erased',
        delivery_count: 5,
        reason: 'content erasure consumer poison: exhausted delivery budget',
      },
    ])
  })

  it('keeps the payload verbatim, so the event can be replayed after the cause is fixed', async () => {
    const payload = { user_id: 'user_1', community_id: 'comm_1', nested: { a: [1, 2] } }
    await recordDeadLetter(db, {
      subscriptionName: 's',
      eventId: 'evt_2',
      subject: 'qaroom.identity.user.comm_1.erased',
      deliveryCount: 5,
      reason: 'r',
      payload,
      streamSequence: 2,
      at: AT,
    })
    const stored = await db.execute(sql`SELECT payload FROM dead_letters WHERE event_id = 'evt_2'`)
    const rows = (stored as unknown as { rows: { payload: unknown }[] }).rows
    expect(rows[0]?.payload).toEqual(payload)
  })

  it('records each redelivery attempt of the same event once, keyed by subscription and event', async () => {
    // A second consumer poisoning the SAME event must not collide with the first, and one consumer
    // re-poisoning it must not accumulate rows without bound.
    const base = {
      eventId: 'evt_3',
      subject: 'qaroom.identity.user.comm_1.erased',
      deliveryCount: 5,
      reason: 'r',
      payload: {},
      streamSequence: 3,
      at: AT,
    }
    await recordDeadLetter(db, { ...base, subscriptionName: 'content-on-user-erased' })
    await recordDeadLetter(db, { ...base, subscriptionName: 'donations-on-user-erased' })
    await recordDeadLetter(db, { ...base, subscriptionName: 'content-on-user-erased' })
    const rows = await deadLetterRows(db)
    expect(rows.map((r) => r.subscription_name).sort()).toEqual([
      'content-on-user-erased',
      'donations-on-user-erased',
    ])
  })
})

/**
 * The primary key is (subscription_name, event_id), and `event_id` falls back to '' when the
 * message carries no Nats-Msg-Id header (settle.ts). So two DIFFERENT header-less losses on one
 * subscription collided on the same key: the second overwrote the first, and because the upsert
 * did not update `subject`, the surviving row welded event A's subject to event B's payload. A
 * corrupted single record is worse than two honest ones.
 */
describe('two distinct losses never collapse into one corrupted row', () => {
  let pg: PGlite
  let db: SqlExecutor
  beforeEach(async () => {
    pg = new PGlite()
    db = drizzle(pg) as unknown as SqlExecutor
    await deadLettersMigration.up(db)
  })
  afterEach(async () => {
    await pg.close()
  })

  it('keeps both header-less losses on one subscription, discriminated by stream sequence', async () => {
    const base = { subscriptionName: 's', eventId: '', deliveryCount: 5, reason: 'r', at: AT }
    await recordDeadLetter(db, {
      ...base,
      subject: 'qaroom.a.x.comm_1.one',
      payload: { which: 'first' },
      streamSequence: 11,
    })
    await recordDeadLetter(db, {
      ...base,
      subject: 'qaroom.b.y.comm_1.two',
      payload: { which: 'second' },
      streamSequence: 12,
    })
    const rows = await deadLetterRows(db)
    expect(rows.map((r) => r.subject).sort()).toEqual([
      'qaroom.a.x.comm_1.one',
      'qaroom.b.y.comm_1.two',
    ])
  })

  it('updates the subject too when a real event is re-poisoned, never welding a stale one', async () => {
    const base = { subscriptionName: 's', eventId: 'evt_9', deliveryCount: 5, reason: 'r', at: AT }
    await recordDeadLetter(db, {
      ...base,
      subject: 'qaroom.old.subject',
      payload: {},
      streamSequence: 1,
    })
    await recordDeadLetter(db, {
      ...base,
      subject: 'qaroom.new.subject',
      payload: {},
      streamSequence: 2,
    })
    const rows = await deadLetterRows(db)
    expect(rows.map((r) => r.subject)).toEqual(['qaroom.new.subject'])
  })
})
