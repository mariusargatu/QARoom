import { SystemClock } from '@qaroom/determinism'
import { gcDedup } from '@qaroom/messaging'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

/**
 * The `jobs:gc-dedup` TTL job for webhooks-service: shed dedup-table rows older than 24h.
 * webhooks publishes NOTHING (recursion guard, ADR-0019) so it has NO outbox — only
 * `processed_events` (consumer dedup across all five channels) and `idempotency_responses`
 * (CRUD replay). Hygiene only (Commitment 17); the cutoff comes from the injected clock, so
 * the job holds the determinism line (no `new Date()`).
 *
 * `webhook_deliveries` (the durable delivery ledger) is DELIBERATELY left unbounded: it is the
 * at-least-once + receiver-dedup audit trail (ADR-0019), so it is retained, not GC'd here. If
 * its growth ever needs bounding, add a generous-retention terminal-row sweep in a later pass.
 */
const connectionString =
  process.env.DATABASE_URL ?? 'postgres://qaroom:qaroom@localhost:5432/qaroom_webhooks'
const TTL_MS = 24 * 60 * 60 * 1000

async function main(): Promise<void> {
  const clock = new SystemClock()
  const client = postgres(connectionString)
  const db = drizzle(client)
  const removed = await gcDedup(db, clock.now(), TTL_MS, {
    outbox: false,
    processedEvents: true,
    idempotencyResponses: true,
  })
  process.stdout.write(
    `gc-dedup[webhooks]: removed ${removed.processedEvents} processed_events + ${removed.idempotencyResponses} idempotency_responses older than ${TTL_MS / 3_600_000}h\n`,
  )
  await client.end()
}

main().catch((err: unknown) => {
  process.stderr.write(`gc-dedup failed: ${String(err)}\n`)
  process.exit(1)
})
