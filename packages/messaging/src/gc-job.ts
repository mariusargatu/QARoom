import { SystemClock } from '@qaroom/determinism'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { type GcTargets, gcDedup } from './gc'

/**
 * The `jobs:gc-dedup` TTL job for the messaging substrate, owned once. It sheds rows older than
 * 24h — aged PUBLISHED outbox rows (already relayed; an unbounded leak until swept) plus the dedup
 * tables. Hygiene only (Commitment 17): correctness rests on the `Nats-Msg-Id` duplicate window
 * plus the `processed_events` table, never on this running on time. The cutoff comes from the
 * injected clock, so the job holds the determinism line (the `new Date()` ban) — `SystemClock` is
 * constructed only here, at the CLI composition root.
 *
 * `targets` lets the SAME code run DSN-parameterized against any service's Postgres: full adopters
 * (content/flags/donations) set all three; pure consumers set only what they migrated (webhooks has
 * no `outbox`, identity has only the Idempotency-Key store). The summary names only enabled targets.
 */
const TTL_MS = 24 * 60 * 60 * 1000

export async function runGcDedupJob(opts: {
  service: string
  defaultDbName: string
  targets: GcTargets
}): Promise<void> {
  const connectionString =
    process.env.DATABASE_URL ?? `postgres://qaroom:qaroom@localhost:5432/${opts.defaultDbName}`
  const clock = new SystemClock()
  const client = postgres(connectionString)
  const db = drizzle(client)
  try {
    const removed = await gcDedup(db, clock.now(), TTL_MS, opts.targets)
    const parts: string[] = []
    if (opts.targets.outbox) parts.push(`${removed.outbox} outbox`)
    if (opts.targets.processedEvents) parts.push(`${removed.processedEvents} processed_events`)
    if (opts.targets.idempotencyResponses) {
      parts.push(`${removed.idempotencyResponses} idempotency_responses`)
    }
    process.stdout.write(
      `gc-dedup[${opts.service}]: removed ${parts.join(' + ')} older than ${TTL_MS / 3_600_000}h\n`,
    )
  } finally {
    await client.end()
  }
}
