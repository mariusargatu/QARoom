import { describe, expect, it } from 'vitest'
import { brokerDouble } from './broker-double'

/**
 * The broker double's three modes are the scenario vocabulary for the messaging edge: a healthy
 * broker, a down broker (the Commitment-17 outbox-retention scenario), and a slow broker the test
 * drains on its own schedule (deterministic latency).
 */
const HEADERS = { 'Nats-Msg-Id': 'evt_1' }

describe('brokerDouble up', () => {
  it('records every published message and resolves', async () => {
    const broker = brokerDouble('up')

    await broker.publish('qaroom.x', { a: 1 }, HEADERS)

    expect(broker.published).toEqual([{ subject: 'qaroom.x', payload: { a: 1 }, headers: HEADERS }])
    expect(broker.pending).toBe(0)
  })
})

describe('brokerDouble down', () => {
  it('rejects every publish and records nothing', async () => {
    const broker = brokerDouble('down')

    await expect(broker.publish('qaroom.x', { a: 1 }, HEADERS)).rejects.toThrow('broker down')
    expect(broker.published).toEqual([])
  })
})

describe('brokerDouble slow', () => {
  it('holds a publish unresolved until the test drains it, then resolves and records the message', async () => {
    const broker = brokerDouble('slow')

    const inFlight = broker.publish('qaroom.x', { a: 1 }, HEADERS)
    expect(broker.pending).toBe(1)
    expect(broker.published).toEqual([])

    broker.flush()
    await inFlight

    expect(broker.pending).toBe(0)
    expect(broker.published).toHaveLength(1)
  })
})
