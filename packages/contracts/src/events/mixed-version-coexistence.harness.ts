import type { z } from 'zod'

/**
 * Runtime N/N+1 mixed-version coexistence harness (T13). Models, in-process, what a zero-
 * unavailability rolling update forces: an N pod (old binary) and an N+1 pod (new binary) bind
 * their OWN durable to the SAME JetStream stream, so BOTH receive every event at once. This module
 * is the non-test substrate — the version-routing SEAM (parse vs quarantine) is production-like
 * logic, so it lives here, not in the `.test.ts`. The test (`./mixed-version-coexistence.test.ts`)
 * supplies the versioned schemas (the frozen `*.v1`/`*.v2` are contracts-internal) and asserts.
 * It models the parse/version boundary only — not the broker (no ordering, redelivery, or dedup).
 */

/** What a consumer sees off the wire: the typed payload plus the `event-version` header value. */
export interface WireMessage {
  readonly eventName: string
  readonly eventVersion: number
  readonly payload: unknown
}

/** A successfully parsed event, tagged with the version the consuming pod read it as. */
export interface ParsedRecord {
  readonly eventName: string
  readonly eventVersion: number
  readonly data: unknown
}

/** Composite parser key: a pod carries one schema per (event-name, version) it was built against. */
export function parserKey(eventName: string, version: number): string {
  return `${eventName}#${version}`
}

/**
 * In-process model of JetStream per-durable fan-out: each bound consumer receives EVERY published
 * message — the simultaneity an N/N+1 window forces. `publish` delivers to every consumer in bind
 * order; there is no ordering, redelivery, or dedup (that is the broker's job, not this boundary's).
 */
export interface CoexistenceBus {
  bind(consumer: (msg: WireMessage) => void): void
  publish(msg: WireMessage): void
}

export function coexistenceBus(): CoexistenceBus {
  const consumers: Array<(msg: WireMessage) => void> = []
  return {
    bind(consumer) {
      consumers.push(consumer)
    },
    publish(msg) {
      for (const deliver of consumers) deliver(msg)
    },
  }
}

/** A consumer pod: its parsed events, the versions it could not understand, and a wire handler. */
export interface Consumer {
  handle(msg: WireMessage): void
  readonly received: ParsedRecord[]
  readonly quarantined: WireMessage[]
}

/**
 * A pod that reads the `event-version` header and routes to its compiled-in schema for that version.
 * A version it has no parser for is QUARANTINED — kept intact, never parsed, never crashed. This is
 * the seam the N/N+1 outage needs: the old pod degrades gracefully across a breaking boundary
 * instead of crash-looping. A version-aware N+1 pod retains BOTH parsers so it can still read the
 * in-flight v1 events a lagging N producer emits during the rollout.
 */
export function versionAwareConsumer(parsers: ReadonlyMap<string, z.ZodType>): Consumer {
  const received: ParsedRecord[] = []
  const quarantined: WireMessage[] = []
  return {
    received,
    quarantined,
    handle(msg) {
      const schema = parsers.get(parserKey(msg.eventName, msg.eventVersion))
      if (!schema) {
        quarantined.push(msg)
        return
      }
      received.push({
        eventName: msg.eventName,
        eventVersion: msg.eventVersion,
        data: schema.parse(msg.payload),
      })
    },
  }
}

/**
 * A pod with NO version seam: it ignores the header and always applies its one pinned schema. On a
 * shape it does not understand `schema.parse` THROWS — the crash-loop a naive rolling update ships
 * the moment an N+1 producer emits a breaking event. `quarantined` is always empty (it has no
 * graceful path); it is kept only so both pod kinds share the `Consumer` shape.
 */
export function versionNaiveConsumer(schema: z.ZodType, assumedVersion: number): Consumer {
  const received: ParsedRecord[] = []
  return {
    received,
    quarantined: [],
    handle(msg) {
      received.push({
        eventName: msg.eventName,
        eventVersion: assumedVersion,
        data: schema.parse(msg.payload),
      })
    },
  }
}
