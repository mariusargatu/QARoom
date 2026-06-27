import type { Coverage, LedgerRow, PostRecord } from '../types'
import type { Disposition, ModeratorDecision } from './moderator-stub'

/**
 * Shared shapes for the TWO-SERVICE composition simulation (T22, ADR-0029). This is the first DST
 * slice that crosses a service boundary: content (producer) and webhooks (consumer) run in ONE
 * process over an in-memory broker, two PGlite databases, and a single virtual clock. The webhooks
 * delivery shapes (`PostRecord`, `LedgerRow`, `Coverage`) are reused verbatim from the single-service
 * DST (../types) — only the CROSS-service vocabulary is new here, so the two slices cannot drift.
 */

/**
 * One event as content actually produced it, read back from content's OUTBOX after the run (the row
 * id IS the `Nats-Msg-Id`). This is the producer-side source of truth the cross-service oracle diffs
 * the webhooks ledger against — "what content emitted" vs "what webhooks delivered".
 */
export interface SourceEvent {
  /** The outbox row id, reused verbatim as the `Nats-Msg-Id` and the consumer's `event_id`. */
  eventId: string
  subject: string
  /** `post.created` / `vote.cast` / … — the `event-name` header the consumer routes on. */
  eventName: string
  communityId: string
  /** Whether the relay marked the row published. A drop still flips this true (the silent loss). */
  published: boolean
}

/** One message the in-memory broker accepted, projected to its STABLE fields (no random traceparent). */
export interface BrokerRecord {
  seq: number
  subject: string
  eventName: string
  msgId: string
  /** The `tenant.id` header — asserted equal to the subject's position-3 community end to end. */
  tenant: string
}

/** Cross-boundary tallies. A "sometimes" floor on each makes an inert composition visible. */
export interface CrossCoverage {
  /** Messages the broker accepted onto the stream (actually crossed the boundary). */
  brokerAccepted: number
  /** Producer-side at-least-once republishes the broker's duplicate window swallowed. */
  brokerDeduped: number
  /** Publishes a fault dropped (only ever non-zero under the planted-bug toggle). */
  brokerDropped: number
  /** Consumer-side at-least-once redeliveries (un-acked → re-polled) the dedup boundary absorbed. */
  redelivered: number
  /** Decisions the moderator stub recorded. */
  decisions: number
  postsCreated: number
  votesCast: number
}

/**
 * The complete deterministic observable of one composed run — the value `runTwiceAndDiff`
 * fingerprints. EVERY field is a pure function of the seed; nothing time-, trace-, or
 * insertion-order-dependent is included (broker records carry stable fields only, never the random
 * W3C traceparent). Two runs of the same seed must produce a byte-identical `ComposedHistory`.
 */
export interface ComposedHistory {
  seed: number
  /** content's outbox, post-run (the producer ledger). */
  sourceEvents: SourceEvent[]
  /** What the broker carried across the boundary. */
  broker: BrokerRecord[]
  /** webhooks' delivery ledger (the consumer ledger). */
  ledger: LedgerRow[]
  /** Every outbound POST the simulated receiver saw (HMAC + dedup raw material). */
  posts: PostRecord[]
  /** The moderator stub's recorded decisions. */
  decisions: ModeratorDecision[]
  /** webhooks send/terminal tallies (reused from the single-service DST). */
  receiverCoverage: Coverage
  /** Cross-boundary tallies. */
  cross: CrossCoverage
  /** Tick passes taken to reach quiescence — a liveness witness (bounded). */
  ticks: number
}

export type { Disposition, ModeratorDecision }

/** A fresh zeroed cross-coverage tally. */
export function emptyCrossCoverage(): CrossCoverage {
  return {
    brokerAccepted: 0,
    brokerDeduped: 0,
    brokerDropped: 0,
    redelivered: 0,
    decisions: 0,
    postsCreated: 0,
    votesCast: 0,
  }
}

/** Sum two cross-coverage tallies (folding per-seed coverage into a sweep total). */
export function mergeCrossCoverage(a: CrossCoverage, b: CrossCoverage): CrossCoverage {
  return {
    brokerAccepted: a.brokerAccepted + b.brokerAccepted,
    brokerDeduped: a.brokerDeduped + b.brokerDeduped,
    brokerDropped: a.brokerDropped + b.brokerDropped,
    redelivered: a.redelivered + b.redelivered,
    decisions: a.decisions + b.decisions,
    postsCreated: a.postsCreated + b.postsCreated,
    votesCast: a.votesCast + b.votesCast,
  }
}
