import type { Meter, ObservableResult } from '@opentelemetry/api'
import type { ConsumerLag } from '@qaroom/contracts'

/**
 * Expose a durable JetStream consumer's lag as OpenTelemetry gauges (ADR-0034) so Prometheus can
 * alert on the consumer-lag SLO. The metric NAMES here are the contract `scripts/gen-alert-rules.ts`
 * alerts on (CONSUMER_LAG_SLO → `qaroom_consumer_num_pending` / `..._oldest_unacked_age_seconds`).
 *
 * This is the metric-EXPOSURE scaffold: {@link consumerLagPoints} is the pure projection (lag reading
 * → gauge points, fully unit-tested) and {@link registerConsumerLagMetrics} wires it onto a Meter.
 * The LIVE feed — polling `consumers.info()` against a running JetStream every scrape — is Tier-B:
 * it needs a cluster, so it is named here, not built (ADR-0034).
 */
export const CONSUMER_LAG_METRIC = {
  numPending: 'qaroom_consumer_num_pending',
  numAckPending: 'qaroom_consumer_num_ack_pending',
  numRedelivered: 'qaroom_consumer_num_redelivered',
  oldestUnackedAgeSeconds: 'qaroom_consumer_oldest_unacked_age_seconds',
} as const

export interface ConsumerLagPoint {
  readonly name: string
  readonly value: number
  readonly attributes: { readonly durable: string }
}

/**
 * Pure projection: a lag reading for one durable → the four gauge points an exporter would publish,
 * each tagged with the `durable` label the alert rules group by. Age is reported in SECONDS (the
 * Prometheus convention; the alert threshold is `maxAckAgeMs / 1000`).
 */
export function consumerLagPoints(durable: string, lag: ConsumerLag): ConsumerLagPoint[] {
  const attributes = { durable }
  return [
    { name: CONSUMER_LAG_METRIC.numPending, value: lag.numPending, attributes },
    { name: CONSUMER_LAG_METRIC.numAckPending, value: lag.numAckPending, attributes },
    { name: CONSUMER_LAG_METRIC.numRedelivered, value: lag.numRedelivered, attributes },
    {
      name: CONSUMER_LAG_METRIC.oldestUnackedAgeSeconds,
      value: lag.oldestUnackedAgeMs / 1000,
      attributes,
    },
  ]
}

export interface ConsumerLagSource {
  /** The durable consumer these readings belong to (becomes the `durable` metric label). */
  readonly durable: string
  /** Latest lag reading; the Tier-B worker refreshes it from `consumers.info()` each scrape. */
  readonly read: () => ConsumerLag
}

/**
 * Register the four consumer-lag gauges on a Meter, re-reading `source.read()` at each collection so
 * the exported value tracks the latest lag. Pure wiring — no I/O of its own.
 */
export function registerConsumerLagMetrics(meter: Meter, source: ConsumerLagSource): void {
  const observe = (result: ObservableResult, point: ConsumerLagPoint | undefined) => {
    if (point) result.observe(point.value, point.attributes)
  }
  // One observable per metric name; each callback re-derives the point from {@link consumerLagPoints}
  // (the single projection) over a fresh `source.read()`, so the exported value tracks live lag.
  for (const { name } of consumerLagPoints(source.durable, source.read())) {
    meter.createObservableGauge(name).addCallback((result) =>
      observe(
        result,
        consumerLagPoints(source.durable, source.read()).find((p) => p.name === name),
      ),
    )
  }
}
