import { runGcDedupJob } from '@qaroom/messaging/gc-job'

/**
 * The `jobs:gc-dedup` TTL job for webhooks-service: shed dedup-table rows older than 24h via the
 * shared substrate job. webhooks publishes NOTHING (recursion guard, ADR-0019) so it has NO outbox
 * — only `processed_events` (consumer dedup across all five channels) and `idempotency_responses`
 * (CRUD replay). Hygiene only (Commitment 17).
 *
 * `webhook_deliveries` (the durable delivery ledger) is DELIBERATELY left unbounded: it is the
 * at-least-once + receiver-dedup audit trail (ADR-0019), so it is retained, not GC'd here. If its
 * growth ever needs bounding, add a generous-retention terminal-row sweep in a later pass.
 */
runGcDedupJob({
  service: 'webhooks',
  defaultDbName: 'qaroom_webhooks',
  targets: { outbox: false, processedEvents: true, idempotencyResponses: true },
}).catch((err: unknown) => {
  process.stderr.write(`gc-dedup failed: ${String(err)}\n`)
  process.exit(1)
})
