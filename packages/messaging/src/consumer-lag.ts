import type { ConsumerLag } from '@qaroom/contracts'

/**
 * The deterministic, in-process model of a durable JetStream consumer draining its backlog, so the
 * consumer-lag SLO (CONSUMER_LAG_SLO, ADR-0034) is falsifiable WITHOUT a live broker — the live
 * `num_pending` observation against a running JetStream is Tier-B. A healthy consumer
 * (capacity >= arrivals) keeps `num_pending` at zero; a STALLED one acks nothing, so the backlog and
 * the oldest-unacked age climb past the SLO and the backpressure gate reds.
 */

/**
 * Deliberate-bug toggle (falsifiable-claims / detection-matrix): stall the consumer so it drains
 * NOTHING and its lag grows unbounded — the `consumer-lag-bounded` claim's gate MUST then go red.
 * Read per call (not at construction) so external env injection is honored however it arrives, the
 * same discipline as CHAOS_TENANT_SPAN_DROP / CHAOS_SKIP_DEDUP.
 */
export function consumerStalled(): boolean {
  return process.env.CHAOS_CONSUMER_STALL === '1'
}

export interface BacklogSim {
  /** Messages arriving on the durable's filter subject per tick. */
  readonly arrivalsPerTick: number
  /** Messages the consumer processes+acks per tick when healthy. */
  readonly capacityPerTick: number
  /** Number of ticks to simulate. */
  readonly ticks: number
  /** Wall-clock ms per tick — drives `oldestUnackedAgeMs` deterministically (no real clock). */
  readonly tickMs: number
}

interface BacklogState {
  readonly pending: number
  /** The tick at which the currently-oldest still-unacked message arrived, or null when caught up. */
  readonly oldestTick: number | null
}

/**
 * Fold the arrival/drain loop over `ticks` ticks and return the resulting lag reading. Immutable:
 * each tick produces a new {@link BacklogState}; no accumulator is mutated and no global clock is
 * read (the age is derived from the tick index, not `Date.now()`).
 */
export function simulateBacklog(sim: BacklogSim): ConsumerLag {
  const drainPerTick = consumerStalled() ? 0 : sim.capacityPerTick
  const final = Array.from({ length: sim.ticks }).reduce<BacklogState>(
    (state, _tick, t) => {
      const afterArrival = state.pending + sim.arrivalsPerTick
      const carriedOldest = afterArrival > 0 ? (state.oldestTick ?? t) : null
      const pending = Math.max(0, afterArrival - drainPerTick)
      return { pending, oldestTick: pending === 0 ? null : carriedOldest }
    },
    { pending: 0, oldestTick: null },
  )
  const oldestUnackedAgeMs =
    final.oldestTick === null ? 0 : (sim.ticks - final.oldestTick) * sim.tickMs
  return {
    numPending: final.pending,
    numAckPending: 0,
    numRedelivered: consumerStalled() ? sim.arrivalsPerTick * sim.ticks : 0,
    oldestUnackedAgeMs,
  }
}
