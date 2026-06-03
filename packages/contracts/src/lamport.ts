import type { Clock, IdGenerator } from '@qaroom/determinism'
import { z } from 'zod'

/**
 * Observable-state envelope (Commitment 7). Every `/system/*` read carries
 * `as_of` so tests and MBT assertions can pin reads against a snapshot.
 */
export const AsOf = z
  .object({
    snapshot_id: z.string(),
    lamport: z.number().int().nonnegative(),
    wall_clock: z.iso.datetime(),
  })
  .meta({
    id: 'AsOf',
    description: 'Read consistency envelope: {snapshot_id, lamport, wall_clock}.',
  })
export type AsOf = z.infer<typeof AsOf>

export interface LamportTick {
  lamport: number
  snapshot_id: string
}

/**
 * Minimal sink for emitting the lamport value as a span attribute. OTel is a
 * Milestone-3 dependency; until then a no-op keeps the seam without pulling the SDK.
 */
export interface SpanAttributeSink {
  setAttribute(key: string, value: number | string): void
}

const NOOP_SINK: SpanAttributeSink = {
  setAttribute() {
    /* no-op until Milestone 3 wires OpenTelemetry */
  },
}

/**
 * The single gate every mutating path funnels through (Commitment 7). It bumps
 * a monotonic per-service counter and emits the new value as an OTel attribute.
 * XState transitions go through the same gate from Milestone 5.
 */
export class LamportGate {
  #counter = 0
  readonly #ids: IdGenerator
  readonly #sink: SpanAttributeSink

  constructor(ids: IdGenerator, sink: SpanAttributeSink = NOOP_SINK) {
    this.#ids = ids
    this.#sink = sink
  }

  /** Bump on every tracked write. Returns the new lamport and a fresh snapshot id. */
  bump(): LamportTick {
    this.#counter += 1
    const tick: LamportTick = { lamport: this.#counter, snapshot_id: this.#ids.next('snap') }
    this.#sink.setAttribute('qaroom.lamport', tick.lamport)
    return tick
  }

  /** Current value for a read, with a fresh snapshot id (no bump). */
  read(): LamportTick {
    return { lamport: this.#counter, snapshot_id: this.#ids.next('snap') }
  }

  get value(): number {
    return this.#counter
  }
}

/** Build the observable-state envelope for a read (Commitment 7). */
export function asOf(clock: Clock, lamport: LamportGate): AsOf {
  const tick = lamport.read()
  return {
    snapshot_id: tick.snapshot_id,
    lamport: tick.lamport,
    wall_clock: clock.now().toISOString(),
  }
}
