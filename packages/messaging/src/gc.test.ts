import { PGlite } from '@electric-sql/pglite'
import { composeMigrations } from '@qaroom/contracts'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { describe, expect, it } from 'vitest'
import { type GcTargets, gcDedup } from './gc'
import { MESSAGING_MIGRATIONS } from './migrations'
import { rowsOf, type SqlExecutor } from './types'

const NOW = new Date('2026-06-03T00:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000)
// The full messaging substrate exists in this db, so every sweep targets every table.
const ALL: GcTargets = { outbox: true, processedEvents: true, idempotencyResponses: true }

async function freshMessagingDb(): Promise<SqlExecutor> {
  const db = drizzle(new PGlite()) as unknown as SqlExecutor
  await composeMigrations(MESSAGING_MIGRATIONS).up(db)
  return db
}

// A minimal published/unpublished outbox row; only id, created_at, published_at vary per case.
async function insertOutboxRow(
  db: SqlExecutor,
  id: string,
  createdAt: Date,
  publishedAt: Date | null,
): Promise<void> {
  await db.execute(
    sql`INSERT INTO outbox (id, subject, event_name, event_version, community_id, payload, trace_context, created_at, published_at)
        VALUES (${id}, 's', 'E', 1, 'c', '{}'::jsonb, '{}'::jsonb, ${createdAt}, ${publishedAt})`,
  )
}

describe('gcDedup removes only dedup rows older than the TTL', () => {
  it('deletes idempotency_responses past 24h and keeps fresher ones', async () => {
    const db = await freshMessagingDb()
    await db.execute(
      sql`INSERT INTO idempotency_responses (idempotency_key, route, body_hash, status, response_body, created_at)
          VALUES ('old', '/r', 'h', 201, '{}'::jsonb, ${hoursAgo(25)}), ('fresh', '/r', 'h', 201, '{}'::jsonb, ${hoursAgo(1)})`,
    )
    const removed = await gcDedup(db, NOW, DAY_MS, ALL)
    expect(removed.idempotencyResponses).toBe(1)
    const remaining = rowsOf<{ idempotency_key: string }>(
      await db.execute(sql`SELECT idempotency_key FROM idempotency_responses`),
    )
    expect(remaining.map((r) => r.idempotency_key)).toEqual(['fresh'])
  })

  it('deletes processed_events past 24h and keeps fresher ones', async () => {
    const db = await freshMessagingDb()
    await db.execute(
      sql`INSERT INTO processed_events (subscription_name, event_id, processed_at)
          VALUES ('s', 'evt_old', ${hoursAgo(48)}), ('s', 'evt_fresh', ${hoursAgo(2)})`,
    )
    const removed = await gcDedup(db, NOW, DAY_MS, ALL)
    expect(removed.processedEvents).toBe(1)
    const remaining = rowsOf<{ event_id: string }>(
      await db.execute(sql`SELECT event_id FROM processed_events`),
    )
    expect(remaining.map((r) => r.event_id)).toEqual(['evt_fresh'])
  })
})

describe('gcDedup sweeps aged published outbox rows but never pending ones', () => {
  it('deletes a published outbox row whose publish is older than the TTL', async () => {
    const db = await freshMessagingDb()
    await insertOutboxRow(db, 'ob_old_pub', hoursAgo(26), hoursAgo(25))
    const removed = await gcDedup(db, NOW, DAY_MS, ALL)
    expect(removed.outbox).toBe(1)
    const remaining = rowsOf<{ id: string }>(await db.execute(sql`SELECT id FROM outbox`))
    expect(remaining.map((r) => r.id)).toEqual([])
  })

  it('keeps a recently published outbox row', async () => {
    const db = await freshMessagingDb()
    await insertOutboxRow(db, 'ob_fresh_pub', hoursAgo(2), hoursAgo(1))
    const removed = await gcDedup(db, NOW, DAY_MS, ALL)
    expect(removed.outbox).toBe(0)
    const remaining = rowsOf<{ id: string }>(await db.execute(sql`SELECT id FROM outbox`))
    expect(remaining.map((r) => r.id)).toEqual(['ob_fresh_pub'])
  })

  it('never deletes an unpublished outbox row even when long aged', async () => {
    const db = await freshMessagingDb()
    await insertOutboxRow(db, 'ob_unpublished_old', hoursAgo(100), null)
    const removed = await gcDedup(db, NOW, DAY_MS, ALL)
    expect(removed.outbox).toBe(0)
    const remaining = rowsOf<{ id: string }>(await db.execute(sql`SELECT id FROM outbox`))
    expect(remaining.map((r) => r.id)).toEqual(['ob_unpublished_old'])
  })
})

describe('gcDedup skips tables the service does not have', () => {
  it('sweeps only idempotency_responses when targets exclude outbox and processed_events', async () => {
    const db = await freshMessagingDb()
    await insertOutboxRow(db, 'ob_old_pub', hoursAgo(26), hoursAgo(25))
    await db.execute(
      sql`INSERT INTO processed_events (subscription_name, event_id, processed_at)
          VALUES ('s', 'evt_old', ${hoursAgo(48)})`,
    )
    await db.execute(
      sql`INSERT INTO idempotency_responses (idempotency_key, route, body_hash, status, response_body, created_at)
          VALUES ('old', '/r', 'h', 201, '{}'::jsonb, ${hoursAgo(25)})`,
    )
    const removed = await gcDedup(db, NOW, DAY_MS, {
      outbox: false,
      processedEvents: false,
      idempotencyResponses: true,
    })
    expect(removed).toEqual({ outbox: 0, processedEvents: 0, idempotencyResponses: 1 })
    const remainingOutbox = rowsOf<{ id: string }>(await db.execute(sql`SELECT id FROM outbox`))
    expect(remainingOutbox.map((r) => r.id)).toEqual(['ob_old_pub'])
  })
})
