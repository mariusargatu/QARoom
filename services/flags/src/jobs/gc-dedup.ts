import { SystemClock } from '@qaroom/determinism'
import { gcDedup } from '@qaroom/messaging'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

/**
 * The `jobs:gc-dedup` TTL job for flags-service: shed messaging-substrate rows older than 24h
 * — aged PUBLISHED outbox rows (already relayed; an unbounded leak until swept) plus the dedup
 * tables. Hygiene only (Commitment 17). Run hourly via the shared chart CronJob; the cutoff
 * comes from the injected clock, so the job holds the determinism line (no `new Date()`).
 * flags has the full substrate, so every target is on.
 */
const connectionString =
  process.env.DATABASE_URL ?? 'postgres://qaroom:qaroom@localhost:5432/qaroom_flags'
const TTL_MS = 24 * 60 * 60 * 1000

async function main(): Promise<void> {
  const clock = new SystemClock()
  const client = postgres(connectionString)
  const db = drizzle(client)
  const removed = await gcDedup(db, clock.now(), TTL_MS, {
    outbox: true,
    processedEvents: true,
    idempotencyResponses: true,
  })
  process.stdout.write(
    `gc-dedup[flags]: removed ${removed.outbox} outbox + ${removed.processedEvents} processed_events + ${removed.idempotencyResponses} idempotency_responses older than ${TTL_MS / 3_600_000}h\n`,
  )
  await client.end()
}

main().catch((err: unknown) => {
  process.stderr.write(`gc-dedup failed: ${String(err)}\n`)
  process.exit(1)
})
