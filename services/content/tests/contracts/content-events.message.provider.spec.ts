import { resolve } from 'node:path'
import {
  PostCreatedEvent,
  parseSubject,
  postCreated,
  VoteCastEvent,
  voteCast,
} from '@qaroom/contracts'
import { createRelay, type TxRunner } from '@qaroom/messaging'
import { messageFromPact, verifyEnvelopeAgainstMessage } from '@qaroom/testing-utils/contracts'
import { injectClient, setupServiceTest } from '@qaroom/testing-utils/harness'
import { brokerDouble, type PublishedMessage } from '@qaroom/testing-utils/scenario'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app'
import { ensureSchema } from '../../src/db/migrate'
import { asContentDb } from '../db-cast'
import { SAMPLE } from '../harness'

/**
 * PROVIDER verification of content's message contracts (post.created, vote.cast).
 *
 * The consumer spec proves a consumer can PARSE the shape; this proves content actually PUBLISHES
 * it — driving a real POST through the service, draining the transactional outbox through the REAL
 * relay into a capturing broker, and checking the captured wire envelope (payload + NATS headers)
 * against the consumer's pinned pact. In-process, per-PR, no broker.
 *
 * Repointed 2026-08-11 at `webhooks-content.json`. The pact it verified against before was written
 * by `community-projection` — a consumer that does not exist — so both halves of the contract were
 * authored by this repo talking to itself, and vote.cast (which had no consumer at all) was checked
 * against the schema content publishes it with, which cannot disagree with itself. webhooks is the
 * real consumer of both subjects.
 */
// The consumer's OWN committed pact — webhooks, a service that exists and binds these subjects.
// Previously `community-projection-content.json`, written by a consumer that did not exist.
const PACT_PATH = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'webhooks',
  'tests',
  'contracts',
  'pacts',
  'webhooks-content.json',
)

async function setup() {
  const test = await setupServiceTest({
    applyMigrations: (db) => ensureSchema(db),
    createApp: (deps) =>
      buildApp({
        db: asContentDb(deps.db),
        clock: deps.clock,
        ids: deps.ids,
        randomness: deps.randomness,
      }),
  })
  return { ...test, request: injectClient(test.app) }
}

type Ctx = Awaited<ReturnType<typeof setup>>

/** Drive the producer, drain the outbox through the real relay, return the captured wire messages. */
async function capturePublished(ctx: Ctx): Promise<PublishedMessage[]> {
  const broker = brokerDouble('up')
  const relay = createRelay({
    db: ctx.db as unknown as TxRunner,
    publisher: broker,
    clock: ctx.clock,
  })
  await relay.drainOnce()
  return broker.published
}

/** Find the published message for an entity, failing loudly (not a cryptic undefined deref) if absent. */
const bySubjectEntity = (messages: PublishedMessage[], entity: string): PublishedMessage => {
  const found = messages.find((m) => parseSubject(m.subject).entity === entity)
  // Clear failure if the producer emitted no such message; the cast is safe past this assertion.
  expect(found, `no published message with entity '${entity}'`).toBeDefined()
  return found as PublishedMessage
}

describe('content publishes a post.created envelope matching the consumer pact', () => {
  let ctx: Ctx
  afterEach(async () => {
    await ctx.close()
  })

  it('the captured wire envelope satisfies every body + metadata matching rule', async () => {
    ctx = await setup()
    const created = await ctx.request.post(
      `/api/communities/${SAMPLE.communityA}/posts`,
      { author_id: SAMPLE.user, title: 'a title', body: 'a body' },
      { 'idempotency-key': 'k-provider-1' },
    )
    expect(created.status).toBe(201)

    const published = await capturePublished(ctx)
    const postMessage = bySubjectEntity(published, 'posts')

    const mismatches = verifyEnvelopeAgainstMessage(
      {
        payload: postMessage.payload as Record<string, unknown>,
        headers: postMessage.headers,
      },
      messageFromPact(PACT_PATH, 'a post created event'),
    )
    expect(mismatches).toEqual([])
  })

  it('the captured payload round-trips through the published PostCreatedEvent schema', async () => {
    ctx = await setup()
    await ctx.request.post(
      `/api/communities/${SAMPLE.communityA}/posts`,
      { author_id: SAMPLE.user, title: 'a title', body: 'a body' },
      { 'idempotency-key': 'k-provider-2' },
    )
    const postMessage = bySubjectEntity(await capturePublished(ctx), 'posts')
    expect(() => PostCreatedEvent.parse(postMessage.payload)).not.toThrow()
  })

  it('sets Nats-Msg-Id equal to the payload event_id (the dedup contract)', async () => {
    ctx = await setup()
    await ctx.request.post(
      `/api/communities/${SAMPLE.communityA}/posts`,
      { author_id: SAMPLE.user, title: 'a title', body: 'a body' },
      { 'idempotency-key': 'k-provider-3' },
    )
    const postMessage = bySubjectEntity(await capturePublished(ctx), 'posts')
    const event = PostCreatedEvent.parse(postMessage.payload)
    expect(postMessage.headers['Nats-Msg-Id']).toBe(event.event_id)
    expect(postMessage.headers['event-name']).toBe('post.created')
    expect(postMessage.headers['event-version']).toBe('1')
    expect(postMessage.headers['tenant.id']).toBe(event.community_id)
    // The SUBJECT is the load-bearing tenancy boundary (community at position 3). Pin it against the
    // builder keyed on the payload's own community — a correct payload on a wrong/cross-tenant
    // subject would otherwise pass the body+header checks unnoticed.
    expect(postMessage.subject).toBe(postCreated(event.community_id))
  })
})

describe('content publishes a vote.cast envelope matching the consumer pact', () => {
  let ctx: Ctx
  afterEach(async () => {
    await ctx.close()
  })

  /** Create a post, vote on it, and return the captured vote.cast wire message. */
  async function captureVote(): Promise<PublishedMessage> {
    ctx = await setup()
    const created = await ctx.request.post(
      `/api/communities/${SAMPLE.communityA}/posts`,
      { author_id: SAMPLE.user, title: 'a title', body: 'a body' },
      { 'idempotency-key': 'k-provider-4' },
    )
    const postId = (created.json as { id: string }).id
    const voted = await ctx.request.post(
      `/api/posts/${postId}/votes`,
      { voter_id: SAMPLE.user, value: 1 },
      { 'idempotency-key': 'k-provider-5' },
    )
    expect(voted.status).toBe(200)
    return bySubjectEntity(await capturePublished(ctx), 'votes')
  }

  // Was "consistent with its source schema" — vote.cast had no consumer pact, so the provider was
  // checked against the shape it publishes, which cannot disagree with itself. webhooks now pins it.
  it('the captured wire envelope satisfies every body + metadata matching rule', async () => {
    const voteMessage = await captureVote()

    const mismatches = verifyEnvelopeAgainstMessage(
      { payload: voteMessage.payload as Record<string, unknown>, headers: voteMessage.headers },
      messageFromPact(PACT_PATH, 'a vote cast event'),
    )
    expect(mismatches).toEqual([])
  })

  it('the captured vote.cast payload round-trips and carries a self-consistent dedup header', async () => {
    const voteMessage = await captureVote()
    const event = VoteCastEvent.parse(voteMessage.payload)
    expect(voteMessage.headers['Nats-Msg-Id']).toBe(event.event_id)
    expect(voteMessage.headers['event-name']).toBe('vote.cast')
    expect(voteMessage.headers['event-version']).toBe('1')
    expect(voteMessage.headers['tenant.id']).toBe(event.community_id)
    expect(voteMessage.subject).toBe(voteCast(event.community_id))
  })
})
