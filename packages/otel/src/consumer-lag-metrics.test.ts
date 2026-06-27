import { MeterProvider } from '@opentelemetry/sdk-metrics'
import type { ConsumerLag } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import {
  CONSUMER_LAG_METRIC,
  consumerLagPoints,
  registerConsumerLagMetrics,
} from './consumer-lag-metrics'

const lag: ConsumerLag = {
  numPending: 1500,
  numAckPending: 12,
  numRedelivered: 4,
  oldestUnackedAgeMs: 45_000,
}

describe('consumerLagPoints', () => {
  it('projects every lag dimension onto its gauge, tagged by durable', () => {
    const points = consumerLagPoints('moderator.on-post', lag)
    const byName = new Map(points.map((p) => [p.name, p]))
    expect(byName.get(CONSUMER_LAG_METRIC.numPending)?.value).toBe(1500)
    expect(byName.get(CONSUMER_LAG_METRIC.numAckPending)?.value).toBe(12)
    expect(byName.get(CONSUMER_LAG_METRIC.numRedelivered)?.value).toBe(4)
    // Age is exported in SECONDS (Prometheus convention; the alert threshold is maxAckAgeMs / 1000).
    expect(byName.get(CONSUMER_LAG_METRIC.oldestUnackedAgeSeconds)?.value).toBe(45)
    expect(points.every((p) => p.attributes.durable === 'moderator.on-post')).toBe(true)
  })
})

describe('registerConsumerLagMetrics', () => {
  it('wires the gauges onto a Meter without throwing', () => {
    const meter = new MeterProvider().getMeter('test')
    expect(() =>
      registerConsumerLagMetrics(meter, { durable: 'webhooks.fanout', read: () => lag }),
    ).not.toThrow()
  })
})
