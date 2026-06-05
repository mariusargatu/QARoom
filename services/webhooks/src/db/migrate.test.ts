import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SqlExecutor } from './client'
import { webhooksMigrations } from './migrate'

/**
 * Migration discipline (docs/05): up → down → up → up(no-op) with structural assertions at each
 * step (NO snapshots). Covers the webhooks-domain tables plus the composed messaging fragments.
 */
const WEBHOOK_TABLES = ['webhook_deliveries', 'webhook_subscriptions']

let pglite: PGlite
let db: SqlExecutor

const tables = async (): Promise<string[]> => {
  const res = await db.execute(
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  )
  return (res as unknown as { rows: Array<{ table_name: string }> }).rows.map((r) => r.table_name)
}

beforeEach(() => {
  pglite = new PGlite()
  db = drizzle(pglite) as unknown as SqlExecutor
})

afterEach(async () => {
  await pglite.close()
})

describe('webhooks migrations', () => {
  it('creates the webhook tables on up', async () => {
    await webhooksMigrations.up(db)
    const present = await tables()
    for (const t of WEBHOOK_TABLES) expect(present).toContain(t)
    expect(present).toContain('processed_events')
    expect(present).toContain('idempotency_responses')
  })

  it('drops the webhook tables on down', async () => {
    await webhooksMigrations.up(db)
    await webhooksMigrations.down(db)
    const present = await tables()
    for (const t of WEBHOOK_TABLES) expect(present).not.toContain(t)
  })

  it('is idempotent: up → down → up → up converges to the same schema', async () => {
    await webhooksMigrations.up(db)
    await webhooksMigrations.down(db)
    await webhooksMigrations.up(db)
    await webhooksMigrations.up(db) // second up is a no-op (IF NOT EXISTS)
    const present = await tables()
    for (const t of WEBHOOK_TABLES) expect(present).toContain(t)
  })
})
