import { runGcDedupJob } from '@qaroom/messaging/gc-job'

/**
 * The `jobs:gc-dedup` TTL job for flags-service. flags has the full messaging substrate, so every
 * target is on. The shared `runGcDedupJob` owns the DSN default, the injected-clock cutoff (no
 * `new Date()`), and the target-driven summary line; this shim just names the service + DB.
 */
runGcDedupJob({
  service: 'flags',
  defaultDbName: 'qaroom_flags',
  targets: { outbox: true, processedEvents: true, idempotencyResponses: true },
}).catch((err: unknown) => {
  process.stderr.write(`gc-dedup failed: ${String(err)}\n`)
  process.exit(1)
})
