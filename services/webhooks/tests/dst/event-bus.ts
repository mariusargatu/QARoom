import { WebhookEventType } from '@qaroom/contracts'
import type { Clock, IdGenerator } from '@qaroom/determinism'
import { processEvent } from '@qaroom/messaging'
import type { SeededRandomness } from '@qaroom/testing-utils/determinism'
import { fanoutHandler, WEBHOOK_FANOUT_DURABLE } from '../../src/consumer'
import type { WebhooksDb } from '../../src/db/client'
import type { Coverage, EndpointProfile, SimConfig } from './types'

/**
 * The SIMULATED EVENT BUS (DST component 4) + the seeded WORKLOAD GENERATOR (component 5).
 *
 * Webhooks publishes nothing — it is a pure consumer — so the "in-memory bus feeding the five NATS
 * channels" is simulated by driving the REAL ingestion path (`processEvent` → `fanoutHandler`)
 * directly, with no broker in the loop. That path carries the two at-least-once dedup boundaries we
 * want to fuzz: per-`(durable, eventId)` via `processed_events`, and per-`(subscription, eventId)`
 * via a unique index. The publisher-side `brokerDouble` does not apply to a pure consumer, so it is
 * deliberately not used here (named in the limits doc).
 */

/** The five domain event types, fixed once (a subscription/event names one of these). */
const EVENT_TYPES = WebhookEventType.options

/** One published domain event, before fan-out. */
export interface SimEvent {
  eventId: string
  communityId: string
  eventType: WebhookEventType
  payload: Record<string, unknown>
}

/** The seeded shape of one subscription to register. */
export interface SubscriptionSpec {
  communityId: string
  url: string
  profile: EndpointProfile
  eventTypes: WebhookEventType[]
}

/**
 * Seed the subscriptions for a world. A floor guarantees variety so the sim always explores both
 * terminal outcomes (and so the planted-bug demo always has a failing endpoint): index 0 is a
 * `down` endpoint and index 1 a `healthy` one, both in the first community; the rest are seeded.
 * Every subscription listens to all five event types (max fan-out), so every channel is exercised.
 */
export function generateSubscriptionSpecs(
  gen: SeededRandomness,
  config: SimConfig,
): SubscriptionSpec[] {
  const profiles: EndpointProfile[] = ['healthy', 'flaky', 'slow', 'down']
  const specs: SubscriptionSpec[] = []
  for (let i = 0; i < config.subscriptionCount; i += 1) {
    const profile = i === 0 ? 'down' : i === 1 ? 'healthy' : pick(gen, profiles)
    const communityId = i < 2 ? firstOf(config.communities) : pick(gen, config.communities)
    specs.push({
      communityId,
      url: `https://hooks.example.test/sub-${i}`,
      profile,
      eventTypes: [...EVENT_TYPES],
    })
  }
  return specs
}

/**
 * Seed the domain events. The first two events are pinned to the first community so the `down` and
 * `healthy` subscriptions there are guaranteed at least one delivery each; the rest are seeded
 * across communities and channels.
 */
export function generateEvents(
  gen: SeededRandomness,
  ids: IdGenerator,
  config: SimConfig,
): SimEvent[] {
  const events: SimEvent[] = []
  for (let i = 0; i < config.eventCount; i += 1) {
    const communityId = i < 2 ? firstOf(config.communities) : pick(gen, config.communities)
    const eventType = pick(gen, EVENT_TYPES)
    const eventId = ids.next('evt')
    events.push({
      eventId,
      communityId,
      eventType,
      payload: { event_id: eventId, community_id: communityId, kind: eventType },
    })
  }
  return events
}

/**
 * The event-fault menu (component 5), applied to the FEED ORDER. Each class fires once per world so
 * the coverage assertion has a non-zero floor (the seed varies WHICH event and the shuffle), and a
 * sim that stopped injecting faults shows up as a zero counter. Duplicates and redeliveries carry
 * the same `eventId`, so the dedup boundaries must collapse them — that is the invariant under test.
 */
export function applyEventFaults(
  gen: SeededRandomness,
  events: SimEvent[],
  coverage: Coverage,
): SimEvent[] {
  if (events.length === 0) return []
  const queue = [...events]

  // event.duplicate — re-insert one event right after itself (same eventId → dedup must swallow it).
  const dupIndex = gen.int(0, queue.length - 1)
  const duped = queue[dupIndex]
  if (duped !== undefined) {
    queue.splice(dupIndex + 1, 0, duped)
    coverage.eventDuplicate += 1
  }

  // event.redeliver — append a late copy of one already-queued event.
  queue.push(pick(gen, events))
  coverage.eventRedeliver += 1

  // event.reorder — a seeded Fisher–Yates shuffle of the whole queue.
  for (let i = queue.length - 1; i > 0; i -= 1) {
    const j = gen.int(0, i)
    const a = queue[i]
    const b = queue[j]
    if (a !== undefined && b !== undefined) {
      queue[i] = b
      queue[j] = a
    }
  }
  coverage.eventReorder += 1

  return queue
}

/**
 * Feed the queued events through the REAL fan-out ingestion (so dedup + the per-target unique index
 * are exercised exactly as in production). Each event becomes Pending delivery rows for every active
 * matching subscription, deduped per `(durable, eventId)` and per `(subscription, eventId)`.
 */
export async function feedEvents(
  db: WebhooksDb,
  clock: Clock,
  ids: IdGenerator,
  queue: SimEvent[],
): Promise<void> {
  for (const event of queue) {
    await processEvent(
      db,
      WEBHOOK_FANOUT_DURABLE,
      { eventId: event.eventId, communityId: event.communityId, payload: event.payload },
      fanoutHandler(
        { ids, clock },
        { eventType: event.eventType, communityId: event.communityId, eventId: event.eventId },
      ),
      clock,
    )
  }
}

function pick<T>(gen: SeededRandomness, items: readonly T[]): T {
  const value = items[gen.int(0, items.length - 1)]
  if (value === undefined) throw new Error('pick: cannot choose from an empty array')
  return value
}

function firstOf<T>(items: readonly T[]): T {
  const value = items[0]
  if (value === undefined) throw new Error('firstOf: empty array')
  return value
}
