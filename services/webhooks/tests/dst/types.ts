import type { WebhookDeliveryTransitionRecord, WebhookEventType } from '@qaroom/contracts'
import type { SendResult } from '../../src/sender'

/**
 * Shared shapes for the in-process Deterministic Simulation Testing (DST) slice (T20, ADR-0029).
 *
 * DST = one process, a virtual clock, a single seed, a simulated world (event bus + flaky
 * receivers), a seed-driven fault injector, and an invariant checker that replays from `seed`.
 * Webhooks is the canonical target: a delivery system with at-least-once, capped-jittered retry,
 * redelivery, poison/dead-letter, HMAC and SSRF — and it already ships the two oracles DST needs
 * (the hand-authored XState delivery machine + spec/tla/WebhookDelivery.tla). The simulation
 * EXPLORES the state space under fuzzed faults; the TLA model PROVES it. These types are the
 * vocabulary the explorer and the oracle agree on.
 */

/** How a simulated receiver endpoint behaves. The seed picks each subscription's profile. */
export type EndpointProfile =
  | 'healthy' // always 2xx — Delivered on the first attempt
  | 'flaky' // a seeded 2xx/5xx mix — usually Delivered, occasionally DeadLettered
  | 'slow' // times out for the first attempts, then recovers (2xx) — exercises retry + recovery
  | 'down' // never accepts (network_error) — exhausts the budget → DeadLettered

/** The four fault classes the injector can fire, named so the coverage assertion can see them. */
export type FaultClass =
  | 'event.duplicate' // same eventId fed twice — the processed_events dedup must swallow it
  | 'event.redeliver' // an already-fed event re-enqueued later — dedup again
  | 'event.reorder' // the event queue shuffled (seeded) before feeding
  | 'crash.midflight' // a ledger write fails after the POST — rollback → re-claim (at-least-once)

/** One simulated subscription: the receiver endpoint plus the secret the HMAC oracle re-derives. */
export interface SimSubscription {
  id: string
  url: string
  secret: string
  communityId: string
  profile: EndpointProfile
}

/** The seed-derived shape of one simulation world (subscriptions + workload size). */
export interface SimConfig {
  /** The single seed: drives the trio, the workload, every fault, and the receiver. */
  seed: number
  /** Communities events and subscriptions are partitioned across (the tenancy boundary). */
  communities: readonly string[]
  /** How many subscriptions to register (a seeded count, with a healthy+down floor). */
  subscriptionCount: number
  /** How many domain events to publish across the five channels. */
  eventCount: number
}

/** One recorded outbound POST as the SIMULATED RECEIVER saw it — the raw material for every oracle. */
export interface PostRecord {
  url: string
  /** The canonical delivery id, read from the body envelope (`delivery_id`) — stable across retries. */
  deliveryId: string
  /** The `X-QARoom-Delivery-Id` HEADER value — the key a real receiver dedupes on. */
  headerDeliveryId: string
  eventId: string
  eventType: WebhookEventType
  /** The `X-QARoom-Timestamp` header, bound into the signature. */
  timestamp: string
  /** The `X-QARoom-Signature` header (`v1=<hex>`). */
  signature: string
  body: string
  /** What the receiver returned for this POST. */
  result: SendResult
}

/** The final committed state of one delivery row (the ledger snapshot the oracle reads). */
export interface LedgerRow {
  id: string
  subscriptionId: string
  communityId: string
  eventId: string
  status: string
  attempt: number
  lastStatusCode: number | null
}

/** Per-class tallies. The coverage ("sometimes") assertion fails if the sim explored nothing. */
export interface Coverage {
  sendSuccess: number
  sendHttpError: number
  sendTimeout: number
  sendNetworkError: number
  eventDuplicate: number
  eventRedeliver: number
  eventReorder: number
  crashMidflight: number
  terminalDelivered: number
  terminalDeadLettered: number
}

/**
 * The complete observable history of one simulation run — the value `runTwiceAndDiff` fingerprints.
 * Two runs of the SAME seed must produce a byte-identical `History`; that is the determinism proof.
 */
export interface History {
  seed: number
  posts: PostRecord[]
  transitions: WebhookDeliveryTransitionRecord[]
  ledger: LedgerRow[]
  coverage: Coverage
  /** Drain passes taken to reach quiescence — a liveness witness (bounded by the attempt budget). */
  passes: number
}

/** A fresh zeroed coverage tally. */
export function emptyCoverage(): Coverage {
  return {
    sendSuccess: 0,
    sendHttpError: 0,
    sendTimeout: 0,
    sendNetworkError: 0,
    eventDuplicate: 0,
    eventRedeliver: 0,
    eventReorder: 0,
    crashMidflight: 0,
    terminalDelivered: 0,
    terminalDeadLettered: 0,
  }
}

/** Sum two coverage tallies (folding per-seed coverage into a sweep total). */
export function mergeCoverage(a: Coverage, b: Coverage): Coverage {
  return {
    sendSuccess: a.sendSuccess + b.sendSuccess,
    sendHttpError: a.sendHttpError + b.sendHttpError,
    sendTimeout: a.sendTimeout + b.sendTimeout,
    sendNetworkError: a.sendNetworkError + b.sendNetworkError,
    eventDuplicate: a.eventDuplicate + b.eventDuplicate,
    eventRedeliver: a.eventRedeliver + b.eventRedeliver,
    eventReorder: a.eventReorder + b.eventReorder,
    crashMidflight: a.crashMidflight + b.crashMidflight,
    terminalDelivered: a.terminalDelivered + b.terminalDelivered,
    terminalDeadLettered: a.terminalDeadLettered + b.terminalDeadLettered,
  }
}

/** Decorrelate a sub-stream's seed from the base seed (uint32), so each source of randomness
 * (workload generation vs receiver responses) draws an independent, still-reproducible sequence. */
export function seedFor(base: number, salt: number): number {
  return (base ^ Math.imul(salt, 0x9e37_79b1)) >>> 0
}
