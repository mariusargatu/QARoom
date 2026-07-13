import { FakeClock, SeededRandomness } from '@qaroom/testing-utils/determinism'
import { describe, expect, it } from 'vitest'
import { CircuitBreaker, CircuitOpenError } from '../resilience/circuit-breaker'
import { createDonationsClient } from './donations-client'

describe('createDonationsClient', () => {
  it('short-circuits with CircuitOpenError once the breaker is open, without touching the network', async () => {
    const breaker = new CircuitBreaker(new FakeClock(), new SeededRandomness(1), {
      threshold: 2,
      cooldownMs: 1000,
      jitterRatio: 0,
    })
    breaker.record(false)
    breaker.record(false) // open now

    // A black-hole base URL: if the breaker did NOT short-circuit, the fetch would be attempted
    // and we'd see a timeout/connection error rather than CircuitOpenError.
    const client = createDonationsClient('http://127.0.0.1:1/unused', { breaker, timeoutMs: 50 })
    await expect(client.listDonations('comm_x')).rejects.toBeInstanceOf(CircuitOpenError)
  })
})
