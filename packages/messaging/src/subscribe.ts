import type { Consumer, JetStreamClient, JsMsg } from '@nats-io/jetstream'
import type { Clock } from '@qaroom/determinism'
import { context, extractTraceContext, traced, withTenant } from '@qaroom/otel'
import { alreadyProcessed, markProcessed } from './dedup'
import { headersToRecord, readEventHeaders } from './headers'
import type { SqlExecutor, TxRunner } from './types'

/** A consumer handler: applies an event's effects within the provided transaction. */
export type EventHandler = (tx: SqlExecutor, payload: unknown) => Promise<void>

export interface DeliveredEvent {
  eventId: string
  communityId: string
  payload: unknown
}

/**
 * Process one delivered event with exactly-once *effects* over at-least-once delivery
 * (Commitment 17): in a single transaction — skip if already processed, else run the
 * handler and record the event id. The handler runs inside `withTenant` so its spans carry
 * `tenant.id`. This is the dedup core; the duplicate-delivery property exercises it with no
 * broker in the loop, which is exactly why that property is cheap and deterministic.
 */
export async function processEvent(
  db: TxRunner,
  subscriptionName: string,
  event: DeliveredEvent,
  handler: EventHandler,
  clock: Clock,
): Promise<{ skipped: boolean }> {
  return db.transaction(async (tx) => {
    if (await alreadyProcessed(tx, subscriptionName, event.eventId)) {
      return { skipped: true }
    }
    await withTenant(event.communityId, () => handler(tx, event.payload))
    await markProcessed(tx, subscriptionName, event.eventId, clock.now())
    return { skipped: false }
  })
}

/**
 * Subscribe a durable JetStream consumer and run `handler` for each message with the trace
 * context restored and dedup applied. FIRST DEPLOYED in Milestone 5 (flags-service); in
 * Milestone 4 only the dedup core (`processEvent`) is exercised, so this loop is integration
 * surface, not unit-tested. Returns a stop function.
 */
export async function runConsumer(opts: {
  js: JetStreamClient
  stream: string
  durable: string
  subscriptionName: string
  db: TxRunner
  clock: Clock
  handler: EventHandler
}): Promise<() => Promise<void>> {
  const consumer: Consumer = await opts.js.consumers.get(opts.stream, opts.durable)
  const messages = await consumer.consume()

  const loop = (async () => {
    for await (const message of messages) {
      const carrier = headersToRecord(message.headers)
      const meta = readEventHeaders(carrier)
      await context.with(extractTraceContext(carrier), () =>
        traced('nats.process', async () => {
          const payload = message.json<unknown>()
          await processEvent(
            opts.db,
            opts.subscriptionName,
            { eventId: meta.eventId, communityId: meta.communityId, payload },
            opts.handler,
            opts.clock,
          )
          message.ack()
        }),
      )
    }
  })()

  return async () => {
    messages.stop()
    await loop
  }
}

// Re-export so callers can type a raw message if they bypass `runConsumer`.
export type { JsMsg }
