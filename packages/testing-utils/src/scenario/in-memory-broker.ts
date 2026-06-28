import { subjectMatchesFilter } from '@qaroom/contracts'

/**
 * A faithful-enough in-memory NATS/JetStream double for CROSS-SERVICE deterministic simulation
 * (T22, ADR-0029). Where `brokerDouble` is a publisher-only sink (one producer, no routing), this
 * is a real bus: many producers publish, many durable consumers each read the whole matching stream
 * once, and the two JetStream properties the cross-service invariants rest on are modelled:
 *
 *   - subject routing      — a durable only sees messages whose subject matches one of its filter
 *                            subjects (`subjectMatchesFilter`, the SAME predicate the producer↔consumer
 *                            routing cross-check uses), so a wildcard consumer can't pick up the wrong
 *                            tenant/entity.
 *   - per-durable delivery  — each durable has its OWN cursor (its own acked set), so the webhooks
 *                            fan-out and the moderator stub independently receive every matching
 *                            message; an un-acked message is redelivered (at-least-once), which is
 *                            exactly the seam the consumer's `processed_events` dedup defends.
 *   - msg-id dedup          — a republished `Nats-Msg-Id` (a relay restart / producer at-least-once
 *                            duplicate) is swallowed by the stream's duplicate window, so it is never
 *                            delivered twice. The cross-service "no event duplicated" oracle leans on
 *                            this AND on the consumer dedup behind it.
 *
 * Like `brokerDouble`, this is shaped STRUCTURALLY to satisfy `@qaroom/messaging`'s `EventPublisher`
 * (`publish(subject, payload, headers)`) without importing it — testing-utils has no messaging
 * dependency by design, so the real `createRelay` drops `broker.publisher` straight in. The header
 * names below mirror `@qaroom/messaging`'s `HEADER` for the same reason (re-declared, not imported).
 *
 * This is NOT real NATS: no network, no streams-on-disk, no flow control, a "remember everything"
 * duplicate window, and delivery is pull-drained by the test rather than pushed. Those limits are
 * named in the cross-service README; what it preserves is the routing + dedup + at-least-once
 * SEMANTICS the boundary invariants actually check.
 */

/** `Nats-Msg-Id` — mirrors `@qaroom/messaging`'s `HEADER.msgId` (re-declared to stay dep-free). */
const MSG_ID_HEADER = 'Nats-Msg-Id'

/** The publisher surface the relay drives. Structurally identical to messaging's `EventPublisher`. */
export interface BrokerPublisher {
  publish(subject: string, payload: unknown, headers: Record<string, string>): Promise<void>
}

/** One message as it sits in the stream (post-dedup, post-drop), with its monotonic sequence. */
export interface BrokerMessage {
  seq: number
  subject: string
  payload: unknown
  headers: Record<string, string>
  /** The `Nats-Msg-Id` header value — the key the duplicate window dedups on (may be ''). */
  msgId: string
}

/** A durable consumer registration: a name plus the filter subjects it binds. */
export interface DurableSpec {
  durable: string
  filterSubjects: readonly string[]
}

/** Running tallies the cross-service coverage assertion reads (an inert bus shows up as zeros). */
export interface BrokerStats {
  /** Messages appended to the stream (actually delivered downstream). */
  accepted: number
  /** Publishes swallowed by the `Nats-Msg-Id` duplicate window. */
  deduped: number
  /** Publishes a fault silently dropped (the planted cross-service bug). */
  dropped: number
}

export interface InMemoryBrokerFaults {
  /**
   * Drop the FIRST published message matching each listed filter subject, once. The publish still
   * RESOLVES (so the relay marks its outbox row published — content believes it shipped), but the
   * message never lands in the stream, so no consumer ever sees it. This is the planted cross-service
   * bug: a silent producer→broker loss that neither service can detect alone, only the cross-service
   * oracle (content's outbox vs the webhooks ledger) catches.
   */
  dropPublishOnce?: readonly string[]
}

export interface InMemoryBroker {
  /** The `EventPublisher`-shaped surface `createRelay` (and any producer) publishes through. */
  readonly publisher: BrokerPublisher
  /** Register a durable consumer over a set of filter subjects. Idempotent per durable name. */
  registerDurable(spec: DurableSpec): void
  /** Un-acked messages matching `durable`'s filters, in stream order. Does NOT advance the cursor. */
  poll(durable: string): BrokerMessage[]
  /** Acknowledge a delivered message for a durable so it is not redelivered. */
  ack(durable: string, seq: number): void
  /** Every accepted message, in stream order (read-only view for oracles). */
  readonly log: readonly BrokerMessage[]
  /** Live tallies (accepted / deduped / dropped). */
  readonly stats: BrokerStats
}

export function inMemoryBroker(faults: InMemoryBrokerFaults = {}): InMemoryBroker {
  const log: BrokerMessage[] = []
  const seenMsgIds = new Set<string>()
  const durables = new Map<string, DurableSpec>()
  const acked = new Map<string, Set<number>>()
  // Each drop filter fires at most once; matched filters are removed so only the FIRST message is lost.
  const pendingDrops: string[] = [...(faults.dropPublishOnce ?? [])]
  const stats: BrokerStats = { accepted: 0, deduped: 0, dropped: 0 }

  function takeDrop(subject: string): boolean {
    const idx = pendingDrops.findIndex((filter) => subjectMatchesFilter(filter, subject))
    if (idx === -1) return false
    pendingDrops.splice(idx, 1)
    return true
  }

  const publisher: BrokerPublisher = {
    publish(subject, payload, headers) {
      const msgId = headers[MSG_ID_HEADER] ?? ''
      if (takeDrop(subject)) {
        stats.dropped += 1
        return Promise.resolve() // resolves: the producer believes it shipped — the silent loss
      }
      // Duplicate window: a republished Nats-Msg-Id is swallowed, never appended (so never delivered).
      if (msgId !== '' && seenMsgIds.has(msgId)) {
        stats.deduped += 1
        return Promise.resolve()
      }
      if (msgId !== '') seenMsgIds.add(msgId)
      log.push({ seq: log.length + 1, subject, payload, headers, msgId })
      stats.accepted += 1
      return Promise.resolve()
    },
  }

  function ackedSet(durable: string): Set<number> {
    const set = acked.get(durable)
    if (!set) throw new Error(`in-memory broker: poll/ack of an unregistered durable '${durable}'`)
    return set
  }

  return {
    publisher,
    log,
    stats,
    registerDurable(spec) {
      durables.set(spec.durable, spec)
      if (!acked.has(spec.durable)) acked.set(spec.durable, new Set())
    },
    poll(durable) {
      const spec = durables.get(durable)
      if (!spec) throw new Error(`in-memory broker: poll of an unregistered durable '${durable}'`)
      const seen = ackedSet(durable)
      return log.filter(
        (m) =>
          !seen.has(m.seq) && spec.filterSubjects.some((f) => subjectMatchesFilter(f, m.subject)),
      )
    },
    ack(durable, seq) {
      ackedSet(durable).add(seq)
    },
  }
}
