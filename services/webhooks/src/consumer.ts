import {
  DONATIONS_FEED_SUBJECT,
  FLAGS_FEED_SUBJECT,
  MODERATION_FEED_SUBJECT,
  POSTS_FEED_SUBJECT,
  VOTES_FEED_SUBJECT,
  WebhookEventType,
} from '@qaroom/contracts'
import type { Clock, IdGenerator } from '@qaroom/determinism'
import {
  consumeDurable,
  type EventHandler,
  headersToRecord,
  type NatsHandle,
  processEvent,
  readEventHeaders,
  settleByDeliveryBudget,
} from '@qaroom/messaging'
import type { WebhooksDb } from './db/client'
import { activeSubscriptionsFor, insertPendingDelivery } from './repository'

/**
 * Durable consumer + dedup subscription name for the fan-out. Hyphenated, not dotted: JetStream
 * rejects a durable name containing '.' (the donations dot-in-durable bug, failure-modes.md §03).
 */
export const WEBHOOK_FANOUT_DURABLE = 'webhooks-fanout'

/**
 * Poison threshold: after this many delivery attempts a message is `term`-ed (dead-lettered)
 * instead of `nak`-ed, so one un-processable event cannot wedge the durable consumer forever.
 * Below it, a failure is transient — `nak` for JetStream redelivery (at-least-once preserved).
 */
export const WEBHOOK_FANOUT_MAX_DELIVERIES = 5

/** The five entity-level feed subjects webhooks fans out (all communities). */
export const WEBHOOK_FEED_SUBJECTS = [
  POSTS_FEED_SUBJECT,
  VOTES_FEED_SUBJECT,
  FLAGS_FEED_SUBJECT,
  DONATIONS_FEED_SUBJECT,
  MODERATION_FEED_SUBJECT,
]

/** Map a NATS `event-name` header to a `WebhookEventType`, or null if it is not a feed event. */
export function classifyEventType(eventName: string): WebhookEventType | null {
  const parsed = WebhookEventType.safeParse(eventName)
  return parsed.success ? parsed.data : null
}

export interface FanoutDeps {
  ids: IdGenerator
  clock: Clock
}

/**
 * The fan-out effect (PURE of NATS — unit-tested directly with no broker). For one consumed
 * event, insert a Pending delivery row for every ACTIVE subscription in the event's community
 * whose `event_types` includes the event type. Runs inside `processEvent`'s transaction, so the
 * whole fan-out is deduped per (WEBHOOK_FANOUT_DURABLE, eventId) — the event is fanned out
 * at-most-once into the ledger, and each row is unique per (subscription, event).
 */
export function fanoutHandler(
  deps: FanoutDeps,
  ctx: { eventType: WebhookEventType; communityId: string; eventId: string },
): EventHandler {
  return async (tx, payload) => {
    const subs = await activeSubscriptionsFor(tx, ctx.communityId, ctx.eventType)
    const now = deps.clock.now()
    for (const sub of subs) {
      await insertPendingDelivery(tx, {
        id: deps.ids.next('whdel'),
        subscriptionId: sub.id,
        communityId: ctx.communityId,
        eventId: ctx.eventId,
        eventType: ctx.eventType,
        payload,
        now,
      })
    }
  }
}

/**
 * Integration surface (NOT unit-tested — no broker in the test loop, mirroring the relay and the
 * gateway WS feed). Subscribe a durable JetStream consumer over all five feed subjects and fan
 * each event into the delivery ledger. Reads `event-name` from the headers (authoritative) to
 * route to the right `WebhookEventType`, restores trace context, and dedups via `processEvent`.
 * The resilient consume loop (per-message span, transient/poison settle, loop-death surfacing) is
 * owned by `runResilientConsume`. Returns a stop function.
 */
export async function startWebhookFanout(
  handle: NatsHandle,
  stream: string,
  db: WebhooksDb,
  deps: FanoutDeps,
): Promise<() => Promise<void>> {
  // `consumeDurable` folds ensureConsumer -> consumers.get -> consume -> runResilientConsume, so the
  // ordering footgun (consumers.get throws unless the durable was created first) cannot be expressed.
  return consumeDurable(
    handle,
    { stream, durable: WEBHOOK_FANOUT_DURABLE, filterSubjects: WEBHOOK_FEED_SUBJECTS },
    {
      spanName: 'nats.process',
      loopDeathSpanName: 'nats.fanout.loop_died',
      traceCarrier: (message) => headersToRecord(message.headers),
      handle: async (message) => {
        const meta = readEventHeaders(headersToRecord(message.headers))
        const eventType = classifyEventType(meta.eventName)
        if (eventType) {
          await processEvent(
            db,
            WEBHOOK_FANOUT_DURABLE,
            {
              eventId: meta.eventId,
              communityId: meta.communityId,
              payload: message.json<unknown>(),
            },
            fanoutHandler(deps, {
              eventType,
              communityId: meta.communityId,
              eventId: meta.eventId,
            }),
            deps.clock,
          )
        }
        message.ack()
      },
      // nak -> redeliver until the budget is exhausted, then term -> dead-letter (poison). Dedup +
      // at-least-once hold: `processEvent` only marks-processed inside the committed transaction, so a
      // nak-driven redelivery re-runs the (deduped) effect rather than dropping the event.
      settle: (message) =>
        settleByDeliveryBudget(message, {
          max: WEBHOOK_FANOUT_MAX_DELIVERIES,
          poisonReason: 'webhooks-fanout poison: exhausted delivery budget',
        }),
    },
  )
}
