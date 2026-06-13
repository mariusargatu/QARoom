import { SystemClock } from '@qaroom/determinism'
import { gcDedup } from '@qaroom/messaging'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

/**
 * The `jobs:gc-dedup` TTL job for identity-service: shed `idempotency_responses` rows older
 * than 24h. identity neither publishes nor consumes events, so it has NO outbox and NO
 * `processed_events` — only the shared Idempotency-Key replay store (Commitment 4). Hygiene
 * only; the cutoff comes from the injected clock, so the job holds the determinism line (no
 * `new Date()`).
 */
const connectionString =
  process.env.DATABASE_URL ?? 'postgres://qaroom:qaroom@localhost:5432/qaroom_identity'
const TTL_MS = 24 * 60 * 60 * 1000

async function main(): Promise<void> {
  const clock = new SystemClock()
  const client = postgres(connectionString)
  const db = drizzle(client)
  const removed = await gcDedup(db, clock.now(), TTL_MS, {
    outbox: false,
    processedEvents: false,
    idempotencyResponses: true,
  })
  process.stdout.write(
    `gc-dedup[identity]: removed ${removed.idempotencyResponses} idempotency_responses older than ${TTL_MS / 3_600_000}h\n`,
  )
  await client.end()
}

main().catch((err: unknown) => {
  process.stderr.write(`gc-dedup failed: ${String(err)}\n`)
  process.exit(1)
})
