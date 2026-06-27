import {
  EXAMPLE_COMMUNITY_ID,
  POSTS_FEED_SUBJECT,
  postCreated,
  VOTES_FEED_SUBJECT,
  voteCast,
} from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { inMemoryBroker } from './in-memory-broker'

/**
 * Unit coverage for the four JetStream-ish properties the cross-service DST oracle leans on: subject
 * routing, independent per-durable cursors, msg-id dedup, and the drop-publish fault that plants the
 * cross-service bug. These run with no PGlite and no services — the broker in isolation.
 */
const POST_SUBJECT = postCreated(EXAMPLE_COMMUNITY_ID)
const VOTE_SUBJECT = voteCast(EXAMPLE_COMMUNITY_ID)
const FANOUT = 'webhooks-fanout'
const MODERATOR = 'moderator'

function headers(msgId: string): Record<string, string> {
  return { 'Nats-Msg-Id': msgId, 'tenant.id': EXAMPLE_COMMUNITY_ID }
}

describe('inMemoryBroker subject routing', () => {
  it('delivers a message only to durables whose filter subjects match', async () => {
    const broker = inMemoryBroker()
    broker.registerDurable({ durable: FANOUT, filterSubjects: [POSTS_FEED_SUBJECT] })

    await broker.publisher.publish(POST_SUBJECT, { a: 1 }, headers('evt_1'))
    await broker.publisher.publish(VOTE_SUBJECT, { a: 2 }, headers('evt_2'))

    const delivered = broker.poll(FANOUT)
    expect(delivered.map((m) => m.subject)).toEqual([POST_SUBJECT])
  })

  it('routes by filter set, so a multi-subject durable sees every matching channel', async () => {
    const broker = inMemoryBroker()
    broker.registerDurable({
      durable: FANOUT,
      filterSubjects: [POSTS_FEED_SUBJECT, VOTES_FEED_SUBJECT],
    })

    await broker.publisher.publish(POST_SUBJECT, { a: 1 }, headers('evt_1'))
    await broker.publisher.publish(VOTE_SUBJECT, { a: 2 }, headers('evt_2'))

    expect(broker.poll(FANOUT).map((m) => m.subject)).toEqual([POST_SUBJECT, VOTE_SUBJECT])
  })
})

describe('inMemoryBroker per-durable cursors', () => {
  it('gives each durable its own view: both the fan-out and the moderator see the same message once', async () => {
    const broker = inMemoryBroker()
    broker.registerDurable({ durable: FANOUT, filterSubjects: [POSTS_FEED_SUBJECT] })
    broker.registerDurable({ durable: MODERATOR, filterSubjects: [POSTS_FEED_SUBJECT] })

    await broker.publisher.publish(POST_SUBJECT, { a: 1 }, headers('evt_1'))

    expect(broker.poll(FANOUT)).toHaveLength(1)
    expect(broker.poll(MODERATOR)).toHaveLength(1)
  })

  it('stops redelivering a message to a durable once it is acked (but not to others)', async () => {
    const broker = inMemoryBroker()
    broker.registerDurable({ durable: FANOUT, filterSubjects: [POSTS_FEED_SUBJECT] })
    broker.registerDurable({ durable: MODERATOR, filterSubjects: [POSTS_FEED_SUBJECT] })
    await broker.publisher.publish(POST_SUBJECT, { a: 1 }, headers('evt_1'))

    for (const msg of broker.poll(FANOUT)) broker.ack(FANOUT, msg.seq)

    expect(broker.poll(FANOUT)).toEqual([])
    // The moderator never acked, so its own cursor still has the message — at-least-once per durable.
    expect(broker.poll(MODERATOR)).toHaveLength(1)
  })

  it('redelivers an un-acked message on the next poll (the at-least-once seam)', async () => {
    const broker = inMemoryBroker()
    broker.registerDurable({ durable: FANOUT, filterSubjects: [POSTS_FEED_SUBJECT] })
    await broker.publisher.publish(POST_SUBJECT, { a: 1 }, headers('evt_1'))

    expect(broker.poll(FANOUT)).toHaveLength(1)
    // No ack between polls ⇒ the same message is delivered again.
    expect(broker.poll(FANOUT)).toHaveLength(1)
  })
})

describe('inMemoryBroker msg-id dedup (duplicate window)', () => {
  it('swallows a republished Nats-Msg-Id so it is never appended or delivered twice', async () => {
    const broker = inMemoryBroker()
    broker.registerDurable({ durable: FANOUT, filterSubjects: [POSTS_FEED_SUBJECT] })

    await broker.publisher.publish(POST_SUBJECT, { a: 1 }, headers('evt_1'))
    await broker.publisher.publish(POST_SUBJECT, { a: 1 }, headers('evt_1')) // relay-restart republish

    expect(broker.stats.accepted).toBe(1)
    expect(broker.stats.deduped).toBe(1)
    expect(broker.log).toHaveLength(1)
    expect(broker.poll(FANOUT)).toHaveLength(1)
  })
})

describe('inMemoryBroker dropPublishOnce fault (the planted cross-service bug)', () => {
  it('resolves the publish but never lands the first matching message, then passes the rest', async () => {
    const broker = inMemoryBroker({ dropPublishOnce: [POSTS_FEED_SUBJECT] })
    broker.registerDurable({ durable: FANOUT, filterSubjects: [POSTS_FEED_SUBJECT] })

    await broker.publisher.publish(POST_SUBJECT, { a: 1 }, headers('evt_1')) // dropped (resolves)
    await broker.publisher.publish(POST_SUBJECT, { a: 2 }, headers('evt_2')) // lands

    expect(broker.stats.dropped).toBe(1)
    const delivered = broker.poll(FANOUT)
    expect(delivered.map((m) => m.msgId)).toEqual(['evt_2'])
  })
})

describe('inMemoryBroker guards', () => {
  it('throws when polling a durable that was never registered', () => {
    const broker = inMemoryBroker()
    expect(() => broker.poll('ghost')).toThrow(/unregistered durable/)
  })
})
