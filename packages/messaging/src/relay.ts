import type { Clock } from '@qaroom/determinism'
import { context, extractTraceContext, traced, withTenant } from '@qaroom/otel'
import { sql } from 'drizzle-orm'
import { buildEventHeaders } from './headers'
import {
  type EventPublisher,
  type PendingEvent,
  rowsOf,
  type SqlExecutor,
  type TxRunner,
} from './types'

const DEFAULT_BATCH = 100

// The live span handed to a `traced` callback. Derived from `traced`'s signature so we don't
// take a direct dependency on `@opentelemetry/api` (it is not in this package's package.json;
// only `@qaroom/otel` is). This is the span `publishOne` records a publish failure on.
type DrainSpan = Parameters<Parameters<typeof traced>[1]>[0]

interface OutboxDbRow {
  id: string
  subject: string
  event_name: string
  event_version: number
  community_id: string
  payload: unknown
  trace_context: Record<string, string> | null
}

export interface Relay {
  /** Drain one batch of unpublished rows; returns how many were published this pass. */
  drainOnce(): Promise<number>
  /**
   * Start a background loop calling `drainOnce` every `intervalMs`; returns a stop fn. The
   * loop is the ONLY timer — tests call `drainOnce` directly so they stay deterministic
   * (no `Clock` leak: published_at still comes from the injected clock).
   */
  start(intervalMs: number): () => void
}

/**
 * The transactional-outbox relay (Commitment 17). One `drainOnce` selects unpublished rows
 * `FOR UPDATE SKIP LOCKED` (so concurrent relays across replicas grab disjoint rows — the
 * single-writer guard), publishes each with its stable `Nats-Msg-Id` and restored trace
 * context, and marks it published. A publish failure leaves the row pending (attempts++)
 * for the next drain — at-least-once, never lost.
 */
export function createRelay(opts: {
  db: TxRunner
  publisher: EventPublisher
  clock: Clock
  batchSize?: number
}): Relay {
  const batch = opts.batchSize ?? DEFAULT_BATCH

  // `drainSpan` is the live drain span (from `traced('outbox.relay.drain')`). A failed
  // publish is caught here so the row stays pending (at-least-once); we record the exception
  // on the drain span so the failure is not silent. `trace.getActiveSpan()` would be the
  // `nats.publish` span — but `traced()` ends it before the throw surfaces, so it is gone by
  // the time we catch. The drain span is the nearest live span, so it carries the signal.
  async function publishOne(
    tx: SqlExecutor,
    event: PendingEvent,
    drainSpan: DrainSpan,
  ): Promise<boolean> {
    const restored = extractTraceContext(event.traceContext)
    try {
      // Re-enter the event's tenant scope so the PRODUCER span carries the community's
      // `tenant.id` (Commitment 9), not the `system` sentinel — the relay loop runs outside
      // any request. `context.with` restores the originating trace so the span links to it.
      await withTenant(event.communityId, () =>
        context.with(restored, async () => {
          const headers = buildEventHeaders(event, event.traceContext)
          await opts.publisher.publish(event.subject, event.payload, headers)
        }),
      )
    } catch (err) {
      drainSpan.recordException(err as Error)
      await tx.execute(sql`UPDATE outbox SET attempts = attempts + 1 WHERE id = ${event.eventId}`)
      return false
    }
    await tx.execute(
      sql`UPDATE outbox SET published_at = ${opts.clock.now().toISOString()}::timestamptz WHERE id = ${event.eventId}`,
    )
    return true
  }

  async function drainOnce(): Promise<number> {
    // Wrap the drain in an explicit span so a thrown/caught failure has a LIVE span to land
    // on. The relay loop runs in a detached `setInterval` callback with NO ambient span, so
    // `trace.getActiveSpan()` would be `undefined` there and `recordException` a silent
    // no-op — exactly the failure that stalls the outbox with zero operator signal. `traced`
    // re-throws and sets ERROR status, so a transaction-level failure (DB/NATS down) is
    // surfaced on the span before it propagates to `start`'s `.catch`.
    return traced('outbox.relay.drain', (drainSpan) =>
      opts.db.transaction(async (tx) => {
        const res = await tx.execute(sql`
          SELECT id, subject, event_name, event_version, community_id, payload, trace_context
          FROM outbox
          WHERE published_at IS NULL
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT ${batch}
        `)
        let published = 0
        for (const row of rowsOf<OutboxDbRow>(res)) {
          const event: PendingEvent = {
            eventId: row.id,
            subject: row.subject,
            eventName: row.event_name,
            eventVersion: row.event_version,
            communityId: row.community_id,
            payload: row.payload,
            traceContext: row.trace_context ?? {},
          }
          if (await publishOne(tx, event, drainSpan)) published += 1
        }
        drainSpan.setAttribute('outbox.relay.published', published)
        return published
      }),
    )
  }

  function start(intervalMs: number): () => void {
    // `drainOnce` already records its own failures on a live span via `traced`; the `.catch`
    // here only keeps a rejected drain from becoming an unhandled rejection in the detached
    // loop (`getActiveSpan()` is undefined here — there is no ambient span in a bare
    // setInterval callback, which is why the recording must happen inside `drainOnce`).
    const timer = setInterval(() => {
      // `drainOnce` records its own failures on its `traced` span; this only stops a rejected
      // tick from becoming an unhandled rejection (matches the loop-death `.catch` shape elsewhere).
      void drainOnce().catch(() => undefined)
    }, intervalMs)
    timer.unref?.()
    return () => clearInterval(timer)
  }

  return { drainOnce, start }
}
