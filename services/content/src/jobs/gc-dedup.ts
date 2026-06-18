import { runGcDedupJob } from '@qaroom/messaging/gc-job'

/**
 * The `jobs:gc-dedup` shim for content-service. The TTL / determinism / summary policy lives once in
 * @qaroom/messaging's runGcDedupJob; content has the full substrate (it publishes via the outbox and
 * dedupes consumed events), so every target is on. Run hourly in dev via the shared chart CronJob.
 */
runGcDedupJob({
  service: 'content',
  defaultDbName: 'qaroom_content',
  targets: { outbox: true, processedEvents: true, idempotencyResponses: true },
}).catch((err: unknown) => {
  process.stderr.write(`gc-dedup failed: ${String(err)}\n`)
  process.exit(1)
})
