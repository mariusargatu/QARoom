import { FLAGS_FEED_SUBJECT, FlagStateChangedEvent } from '@qaroom/contracts'
import type { Clock } from '@qaroom/determinism'
import {
  consumeDurable,
  type EventHandler,
  headersToRecord,
  type NatsHandle,
  processEvent,
  readEventHeaders,
  settleByDeliveryBudget,
} from '@qaroom/messaging'
import type { DonationsDb } from './db/client'
import { setFlagEnabled } from './repository'

/**
 * Durable consumer + dedup subscription name for the flag-state projection. Hyphenated, not
 * dotted: JetStream rejects a durable name containing '.' (`InvalidNameError`).
 */
export const FLAG_SUBSCRIPTION = 'donations-on-flag-state'

/**
 * Poison threshold: after this many delivery attempts a message is `term`-ed (dead-lettered)
 * instead of `nak`-ed, so one un-processable event (e.g. a payload that fails the Zod parse on
 * every redelivery) cannot wedge the durable consumer forever. Below it, a failure is treated as
 * transient — `nak` for JetStream redelivery (at-least-once preserved).
 */
export const FLAG_CONSUMER_MAX_DELIVERIES = 5

/**
 * Project `flag.state.changed` events into the local `flag_cache` so donation gating reads a
 * cache instead of calling flags-service synchronously. Dedup + tenant scope are handled by
 * `processEvent`; this handler is the pure effect, unit-tested directly with no broker.
 */
export function flagStateChangedHandler(clock: Clock): EventHandler {
  return async (tx, payload) => {
    const evt = FlagStateChangedEvent.parse(payload)
    await setFlagEnabled(tx, evt.community_id, evt.flag_key, evt.enabled, clock.now())
  }
}

/**
 * Integration surface (NOT unit-tested — no broker in the test loop, mirroring the webhooks
 * fan-out and the gateway WS feed). Start the durable JetStream consumer that keeps the flag
 * cache current. `consumeDurable` folds the `ensureConsumer -> consumers.get -> consume` bootstrap
 * (filtered to flag events only — donations publishes donation events to the same stream, which
 * this handler must not see) so the get-before-ensure ordering footgun is impossible to express.
 * Restores trace context from the headers and dedups via `processEvent` (which runs the handler
 * inside `withTenant`, so its spans carry `tenant.id`). The resilient consume loop (per-message
 * span, transient/poison settle, loop-death surfacing) is owned by `consumeDurable`.
 * Returns a stop function.
 *
 * Replay note: a freshly-created durable defaults to deliver-from-start, so on first creation it
 * replays the flag history to REBUILD the cache; thereafter the durable resumes from its acked
 * position across restarts. This is safe only because `flagStateChangedHandler` is an idempotent
 * upsert — a future non-idempotent consumer would need an explicit deliver policy and/or an
 * occurred_at guard.
 */
export async function startDonationsConsumer(
  handle: NatsHandle,
  stream: string,
  db: DonationsDb,
  clock: Clock,
): Promise<() => Promise<void>> {
  return consumeDurable(
    handle,
    { stream, durable: FLAG_SUBSCRIPTION, filterSubjects: [FLAGS_FEED_SUBJECT] },
    {
      spanName: 'nats.process',
      loopDeathSpanName: 'nats.donations.loop_died',
      traceCarrier: (message) => headersToRecord(message.headers),
      handle: async (message) => {
        const meta = readEventHeaders(headersToRecord(message.headers))
        await processEvent(
          db,
          FLAG_SUBSCRIPTION,
          {
            eventId: meta.eventId,
            communityId: meta.communityId,
            payload: message.json<unknown>(),
          },
          flagStateChangedHandler(clock),
          clock,
        )
        message.ack()
      },
      // nak -> redeliver until the budget is exhausted, then term -> dead-letter (poison). Dedup +
      // at-least-once hold: `processEvent` only marks-processed inside the committed transaction, so
      // a nak-driven redelivery re-runs the (deduped) effect rather than dropping the event.
      settle: (message) =>
        settleByDeliveryBudget(message, {
          max: FLAG_CONSUMER_MAX_DELIVERIES,
          poisonReason: 'donations flag consumer poison: exhausted delivery budget',
        }),
    },
  )
}
