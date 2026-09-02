import { SystemClock } from '@qaroom/determinism'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { processEvent } from './subscribe'
import {
  recordEffect,
  type SubscribePgFixture,
  setupSubscribePg,
} from './subscribe-concurrency.testkit'

/**
 * Consumer dedup under REAL concurrency (Commitment 17).
 *
 * `processEvent` is correct: `alreadyProcessed` takes a transaction-scoped advisory lock on
 * `subscription:eventId` before its check, so two deliveries of the same event serialize and the
 * second finds it processed. That has been true since the original commit.
 *
 * What was missing is any test that could TELL. Every consumer test runs on PGlite — one in-process
 * connection — which serializes the two transactions regardless, so the suite passes identically
 * whether the lock is there or not. This spec puts the two deliveries on two real connections,
 * which is the only arrangement where the lock does any work. Falsified by deleting the
 * `pg_advisory_xact_lock` line: this reds, and nothing else in the repo does.
 *
 * The scenario is not hypothetical: JetStream redelivers when `ack_wait` expires while the first
 * attempt is still running, and a service scaled past one replica can have both in flight at once.
 */
const SUBSCRIPTION = 'concurrency-spec'
const EVENT_ID = 'evt_01HZY0K7M3QF8VN2J5RX9TB4CD'
const COMMUNITY = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD'

const fx = await setupSubscribePg()
const fixture = fx as SubscribePgFixture

/** Deliver the same event `n` times at once, as a redelivery race would. */
async function deliverConcurrently(n: number, eventId: string) {
  return Promise.allSettled(
    Array.from({ length: n }, () =>
      processEvent(
        fixture.db,
        SUBSCRIPTION,
        { eventId, communityId: COMMUNITY, payload: { hello: 'world' } },
        recordEffect(eventId),
        new SystemClock(),
      ),
    ),
  )
}

describe.skipIf(!fx)('processEvent applies an event once under concurrent redelivery', () => {
  beforeEach(async () => {
    await fixture.reset()
  })

  afterAll(async () => {
    await (fx as SubscribePgFixture | null)?.stop()
  })

  it('runs the handler effect exactly once for four concurrent deliveries of one event', async () => {
    await deliverConcurrently(4, EVENT_ID)

    expect(await fixture.effectCount()).toBe(1)
  })

  it('reports exactly one delivery as applied and the rest as skipped', async () => {
    const results = await deliverConcurrently(4, EVENT_ID)

    const applied = results.filter(
      (r) => r.status === 'fulfilled' && r.value.skipped === false,
    ).length
    expect(applied).toBe(1)
  })

  it('does not fail any of the racing deliveries (a skip is a success, not an error)', async () => {
    const results = await deliverConcurrently(4, EVENT_ID)

    expect(results.filter((r) => r.status === 'rejected')).toEqual([])
  })

  it('still applies a DIFFERENT event (the lock serializes per event, not globally)', async () => {
    await deliverConcurrently(2, EVENT_ID)
    await deliverConcurrently(2, 'evt_01HZY0K7M3QF8VN2J5RX9TB4CE')

    expect(await fixture.effectCount()).toBe(2)
  })
})
