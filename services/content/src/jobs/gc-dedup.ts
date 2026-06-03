import { SystemClock } from '@qaroom/determinism'
import { gcDedup } from '@qaroom/messaging'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { schema } from '../db/schema'

/**
 * The `jobs:gc-dedup` TTL job for content-service: shed dedup rows older than 24h. Hygiene
 * only (Commitment 17). Run hourly in dev via a CronJob; the cutoff comes from the injected
 * clock, so the job holds the determinism line (no `new Date()`).
 */
const connectionString =
  process.env.DATABASE_URL ?? 'postgres://qaroom:qaroom@localhost:5432/qaroom_content'
const TTL_MS = 24 * 60 * 60 * 1000

async function main(): Promise<void> {
  const clock = new SystemClock()
  const client = postgres(connectionString)
  const db = drizzle(client, { schema })
  const removed = await gcDedup(db, clock.now(), TTL_MS)
  process.stdout.write(
    `gc-dedup: removed ${removed.idempotencyResponses} idempotency_responses + ${removed.processedEvents} processed_events older than ${TTL_MS / 3_600_000}h\n`,
  )
  await client.end()
}

main().catch((err: unknown) => {
  process.stderr.write(`gc-dedup failed: ${String(err)}\n`)
  process.exit(1)
})
