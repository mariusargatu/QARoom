import { runGcDedupJob } from '@qaroom/messaging/gc-job'

/**
 * identity's `jobs:gc-dedup` shim. identity neither publishes nor consumes events, so it has NO
 * outbox and NO `processed_events` — only the shared Idempotency-Key replay store (Commitment 4).
 * The generic TTL/determinism discipline lives in `runGcDedupJob`; this file only declares which
 * tables identity actually migrated.
 */
runGcDedupJob({
  service: 'identity',
  defaultDbName: 'qaroom_identity',
  targets: { outbox: false, processedEvents: false, idempotencyResponses: true },
}).catch((err: unknown) => {
  process.stderr.write(`gc-dedup failed: ${String(err)}\n`)
  process.exit(1)
})
