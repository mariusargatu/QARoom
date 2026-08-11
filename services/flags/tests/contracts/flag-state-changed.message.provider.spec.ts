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
const PACT_PATH = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'donations',
  'tests',
  'contracts',
  'pacts',
  'donations-flags.json',
)

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

  it('the captured wire envelope satisfies every body + metadata matching rule', async () => {
    ctx = await setupFlagsTest()
    const message = await captureFlagChange(ctx)

    const mismatches = verifyEnvelopeAgainstMessage(
      { payload: message.payload as Record<string, unknown>, headers: message.headers },
      messageFromPact(PACT_PATH, 'a flag state changed event'),
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
