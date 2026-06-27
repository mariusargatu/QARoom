import { CONSUMER_LAG_SLO, evaluateConsumerLag } from '@qaroom/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { consumerStalled, simulateBacklog } from './consumer-lag'

// A healthy durable: capacity (150/tick) outpaces arrivals (100/tick), so the backlog never grows.
const HEALTHY: Parameters<typeof simulateBacklog>[0] = {
  arrivalsPerTick: 100,
  capacityPerTick: 150,
  ticks: 60,
  tickMs: 1000,
}

describe('consumer-lag SLO (backpressure gate)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // The guarantee test `pnpm prove consumer-lag-bounded --break` runs: armed with CHAOS_CONSUMER_STALL
  // the consumer drains nothing, num_pending and the oldest-unacked age climb past CONSUMER_LAG_SLO,
  // and this assertion fails (red). Keep the name a regex-safe, unique substring for the `-t` filter.
  it('keeps consumer lag within the SLO under sustained delivery', () => {
    const lag = simulateBacklog(HEALTHY)
    expect(evaluateConsumerLag(lag).breached).toBe(false)
  })

  it('catches a stalled consumer as an SLO breach when the toggle is armed', () => {
    vi.stubEnv('CHAOS_CONSUMER_STALL', '1')
    expect(consumerStalled()).toBe(true)
    const verdict = evaluateConsumerLag(simulateBacklog(HEALTHY))
    expect(verdict.breached).toBe(true)
    expect(verdict.breaches.length).toBeGreaterThan(0)
  })
})

describe('evaluateConsumerLag derives its bound from CONSUMER_LAG_SLO', () => {
  const caughtUp = { numPending: 0, numAckPending: 3, numRedelivered: 0, oldestUnackedAgeMs: 10 }

  it('passes a caught-up consumer', () => {
    expect(evaluateConsumerLag(caughtUp).breached).toBe(false)
  })

  it('flags num_pending over the SLO max', () => {
    const verdict = evaluateConsumerLag({
      ...caughtUp,
      numPending: CONSUMER_LAG_SLO.maxPending + 1,
    })
    expect(verdict.breached).toBe(true)
  })

  it('flags oldest-unacked age over the SLO max', () => {
    const verdict = evaluateConsumerLag({
      ...caughtUp,
      oldestUnackedAgeMs: CONSUMER_LAG_SLO.maxAckAgeMs + 1,
    })
    expect(verdict.breached).toBe(true)
  })
})

describe('simulateBacklog', () => {
  it('drains a healthy consumer to zero pending', () => {
    expect(simulateBacklog(HEALTHY).numPending).toBe(0)
  })

  it('accumulates the full backlog when the consumer is stalled', () => {
    vi.stubEnv('CHAOS_CONSUMER_STALL', '1')
    const lag = simulateBacklog(HEALTHY)
    expect(lag.numPending).toBe(HEALTHY.arrivalsPerTick * HEALTHY.ticks)
    expect(lag.oldestUnackedAgeMs).toBe(HEALTHY.ticks * HEALTHY.tickMs)
    vi.unstubAllEnvs()
  })
})
