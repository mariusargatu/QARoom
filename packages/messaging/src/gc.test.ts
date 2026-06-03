import { PGlite } from '@electric-sql/pglite'
import { composeMigrations } from '@qaroom/contracts'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { describe, expect, it } from 'vitest'
import { gcDedup } from './gc'
import { MESSAGING_MIGRATIONS } from './migrations'
import { rowsOf, type SqlExecutor } from './types'

const NOW = new Date('2026-06-03T00:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000)

async function freshMessagingDb(): Promise<SqlExecutor> {
  const db = drizzle(new PGlite()) as unknown as SqlExecutor
  await composeMigrations(MESSAGING_MIGRATIONS).up(db)
  return db
}

describe('gcDedup removes only dedup rows older than the TTL', () => {
  it('deletes idempotency_responses past 24h and keeps fresher ones', async () => {
    const db = await freshMessagingDb()
    await db.execute(
      sql`INSERT INTO idempotency_responses (idempotency_key, route, body_hash, status, response_body, created_at)
          VALUES ('old', '/r', 'h', 201, '{}'::jsonb, ${hoursAgo(25)}), ('fresh', '/r', 'h', 201, '{}'::jsonb, ${hoursAgo(1)})`,
    )
    const removed = await gcDedup(db, NOW, DAY_MS)
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
    const removed = await gcDedup(db, NOW, DAY_MS)
    expect(removed.processedEvents).toBe(1)
    const remaining = rowsOf<{ event_id: string }>(
      await db.execute(sql`SELECT event_id FROM processed_events`),
    )
    expect(remaining.map((r) => r.event_id)).toEqual(['evt_fresh'])
  })
})
