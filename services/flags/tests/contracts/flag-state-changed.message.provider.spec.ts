import { resolve } from 'node:path'
import { FlagStateChangedEvent, flagStateChanged, parseSubject } from '@qaroom/contracts'
import { createRelay, type TxRunner } from '@qaroom/messaging'
import { messageFromPact, verifyEnvelopeAgainstMessage } from '@qaroom/testing-utils/contracts'
import { brokerDouble, type PublishedMessage } from '@qaroom/testing-utils/scenario'
import { afterEach, describe, expect, it } from 'vitest'
import { type FlagsTestCtx, SAMPLE, setupFlagsTest } from '../harness'

/**
 * PROVIDER verification of the `flag.state.changed` message contract.
 *
 * donations-service consumes this event to keep its gating cache current, and until 2026-08-11 that
 * relationship had NO contract in either direction — flags could rename or drop `enabled` and the
 * only thing that would notice was production. `asyncapi:verify` would not: it regenerates the spec
 * from the same Zod schema the change edited, so both sides move together and the drift gate stays
 * green.
 *
 * Mirrors content's provider spec: drive a real rollout transition through the service, drain the
 * transactional outbox through the REAL relay into a capturing broker, and check the captured wire
 * envelope (payload + NATS headers) against the consumer's pinned pact. In-process, no broker.
 */
/**
 * BOTH consumers, not just one. donations reads `enabled` to gate its endpoints; webhooks routes on
 * the headers and forwards the whole body to a third-party endpoint. Satisfying one says nothing
 * about the other — flags could keep donations happy while breaking the payload webhooks ships
 * onward — so the same captured envelope is checked against every pact that names flags as provider.
 */
const consumerPact = (consumer: string, file: string) =>
  resolve(import.meta.dirname, '..', '..', '..', consumer, 'tests', 'contracts', 'pacts', file)

const CONSUMER_PACTS = [
  { consumer: 'donations', path: consumerPact('donations', 'donations-flags.json') },
  { consumer: 'webhooks', path: consumerPact('webhooks', 'webhooks-flags.json') },
] as const

/** Advance the rollout, drain the outbox through the real relay, return the captured message. */
async function captureFlagChange(ctx: FlagsTestCtx): Promise<PublishedMessage> {
  const advanced = await ctx.request.post(
    `/api/communities/${SAMPLE.communityA}/flags/${SAMPLE.flag}/rollout`,
    { event: 'EnableRequested' },
    { 'idempotency-key': 'k-flag-provider-1' },
  )
  expect(advanced.status).toBe(200)

  const broker = brokerDouble('up')
  await createRelay({
    db: ctx.db as unknown as TxRunner,
    publisher: broker,
    clock: ctx.clock,
  }).drainOnce()

  const found = broker.published.find((m) => parseSubject(m.subject).entity === 'flag')
  expect(found, "no published message with entity 'flag'").toBeDefined()
  return found as PublishedMessage
}

describe('flags publishes a flag.state.changed envelope matching the consumer pact', () => {
  let ctx: FlagsTestCtx
  afterEach(async () => {
    await ctx.close()
  })

  it.each(
    CONSUMER_PACTS,
  )("the captured wire envelope satisfies every rule $consumer's pact declares", async ({
    path,
  }) => {
    ctx = await setupFlagsTest()
    const message = await captureFlagChange(ctx)

    const mismatches = verifyEnvelopeAgainstMessage(
      { payload: message.payload as Record<string, unknown>, headers: message.headers },
      messageFromPact(path, 'a flag state changed event'),
    )
    expect(mismatches).toEqual([])
  })

  it('the captured payload round-trips through the published FlagStateChangedEvent schema', async () => {
    ctx = await setupFlagsTest()
    const message = await captureFlagChange(ctx)
    expect(() => FlagStateChangedEvent.parse(message.payload)).not.toThrow()
  })

  it('sets Nats-Msg-Id equal to the payload event_id (the dedup contract)', async () => {
    ctx = await setupFlagsTest()
    const message = await captureFlagChange(ctx)
    const event = FlagStateChangedEvent.parse(message.payload)
    expect(message.headers['Nats-Msg-Id']).toBe(event.event_id)
    expect(message.headers['event-name']).toBe('flag.state.changed')
    expect(message.headers['event-version']).toBe('1')
    expect(message.headers['tenant.id']).toBe(event.community_id)
    // The SUBJECT carries the tenancy boundary (community at position 3): a correct payload on a
    // cross-tenant subject would pass every body/header check and still leak across communities.
    expect(message.subject).toBe(flagStateChanged(event.community_id))
  })
})

// Outside the block above on purpose: that describe's afterEach closes the per-test PGlite, and a
// test that never opens one would double-close the previous test's.
describe('the provider verification covers every consumer', () => {
  it('checks more than one consumer pact (a dropped one would go unnoticed)', () => {
    expect(CONSUMER_PACTS.map((p) => p.consumer)).toEqual(['donations', 'webhooks'])
  })
})
