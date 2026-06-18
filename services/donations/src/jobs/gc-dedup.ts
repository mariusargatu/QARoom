import { runGcDedupJob } from '@qaroom/messaging/gc-job'

/**
 * The `jobs:gc-dedup` TTL job for donations-service: shed messaging-substrate rows older than 24h —
 * aged PUBLISHED outbox rows (already relayed; an unbounded leak until swept) plus the dedup tables.
 * Hygiene only (Commitment 17). Run hourly via the shared chart CronJob. donations has the full
 * substrate, so every target is on. The DSN default, TTL, injected-clock cutoff (no `new Date()`),
 * and summary line are owned by `runGcDedupJob`.
 */
runGcDedupJob({
  service: 'donations',
  defaultDbName: 'qaroom_donations',
  targets: { outbox: true, processedEvents: true, idempotencyResponses: true },
}).catch((err: unknown) => {
  process.stderr.write(`gc-dedup failed: ${String(err)}\n`)
  process.exit(1)
})
