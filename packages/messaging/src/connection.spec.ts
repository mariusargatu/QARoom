import { jetstream, jetstreamManager } from '@nats-io/jetstream'
import { headers, type NatsConnection } from '@nats-io/nats-core'
import {
  ALL_FEED_SUBJECTS,
  CommunityId,
  donationStateChanged,
  postCreated,
  QAROOM_STREAM_SUBJECTS,
  subjectMatchesFilter,
  userErased,
  voteCast,
} from '@qaroom/contracts'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ensureConsumer, ensureStream, QAROOM_STREAM } from './connection'
import { type NatsFixture, setupNats } from './connection.testkit'

/**
 * Integration spec for the NATS boot path against a REAL JetStream server. Before this,
 * `connection.ts` had no test at all and every messaging test in the repo talked to
 * `brokerDouble` / `inMemoryBroker` — so three load-bearing claims rested entirely on doubles that
 * implement the very behaviour they were asserting:
 *
 *  1. the stream carries `duplicate_window` (Commitment 17's SERVER-side dedup half);
 *  2. a same-`Nats-Msg-Id` republish is actually swallowed by that window;
 *  3. `subjectMatchesFilter` — QARoom's own reimplementation of NATS wildcard matching, and the
 *     oracle in webhooks'/gateway's/content's routing specs and inside `inMemoryBroker` — agrees
 *     with what the real server routes. A divergence there was invisible everywhere at once,
 *     because model and test shared the same wrong answer.
 *
 * Gated on QAROOM_NATS_TESTS + Docker (see the testkit); skips cleanly otherwise.
 */
const fx = await setupNats()
const nc = fx?.connection as NatsConnection

const COMMUNITY = CommunityId.parse('comm_01HZY0K7M3QF8VN2J5RX9TB4CD')
const OTHER = CommunityId.parse('comm_01HZY0K7M3QF8VN2J5RX9TB4CE')

/** Commitment 17's window, as `connection.ts` sets it. Nanoseconds on the wire. */
const DUPLICATE_WINDOW_NS = 5 * 60 * 1_000_000_000

/** Publish through core NATS-on-JetStream with an explicit `Nats-Msg-Id`, as the relay does. */
async function publish(subject: string, msgId: string): Promise<void> {
  const h = headers()
  h.set('Nats-Msg-Id', msgId)
  await jetstream(nc).publish(subject, JSON.stringify({ msgId }), { headers: h })
}

async function streamMessageCount(): Promise<number> {
  const info = await (await jetstreamManager(nc)).streams.info(QAROOM_STREAM)
  return info.state.messages
}

/** Drop and recreate the stream so each test sees an empty duplicate window and message count. */
async function freshStream(): Promise<void> {
  const jsm = await jetstreamManager(nc)
  await jsm.streams.delete(QAROOM_STREAM).catch(() => undefined)
  await ensureStream(nc)
}

// File-level, NOT inside the first describe: an afterAll nested in one block tears the container
// down when THAT block finishes, and every later block then fails with "closed connection".
afterAll(async () => {
  await (fx as NatsFixture | null)?.stop()
})

describe.skipIf(!fx)('ensureStream provisions the stream the outbox relay publishes into', () => {
  beforeEach(freshStream)

  it('creates the qaroom stream over the whole subject tree', async () => {
    const info = await (await jetstreamManager(nc)).streams.info(QAROOM_STREAM)
    expect(info.config.subjects).toEqual([QAROOM_STREAM_SUBJECTS])
  })

  // The single most load-bearing server-side setting in the messaging layer, and the one the
  // in-memory double cannot vouch for: it models an INFINITE window, production sets 5 minutes.
  it('sets duplicate_window to the 5 minutes Commitment 17 specifies', async () => {
    const info = await (await jetstreamManager(nc)).streams.info(QAROOM_STREAM)
    expect(info.config.duplicate_window).toBe(DUPLICATE_WINDOW_NS)
  })

  it('is idempotent: a second call on an existing stream keeps the window', async () => {
    await ensureStream(nc)
    const info = await (await jetstreamManager(nc)).streams.info(QAROOM_STREAM)
    expect(info.config.duplicate_window).toBe(DUPLICATE_WINDOW_NS)
  })

  it('is safe to call on every boot (repeated calls do not throw)', async () => {
    await expect(ensureStream(nc).then(() => ensureStream(nc))).resolves.toBeUndefined()
  })
})

describe.skipIf(!fx)('the real duplicate window enforces the Nats-Msg-Id dedup contract', () => {
  beforeEach(freshStream)

  // A relay restart republishes un-acked outbox rows. This is the server-side half of the "no event
  // is delivered twice" claim; `processed_events` is the consumer-side half. Only ever asserted
  // against a double that implemented the dedup itself, until now.
  it('stores one message when the same Nats-Msg-Id is published twice', async () => {
    await publish(postCreated(COMMUNITY), 'evt_01HZY0K7M3QF8VN2J5RX9TB4CD')
    await publish(postCreated(COMMUNITY), 'evt_01HZY0K7M3QF8VN2J5RX9TB4CD')

    expect(await streamMessageCount()).toBe(1)
  })

  it('stores both when the msg-ids differ (the window is not swallowing distinct events)', async () => {
    await publish(postCreated(COMMUNITY), 'evt_01HZY0K7M3QF8VN2J5RX9TB4CD')
    await publish(postCreated(COMMUNITY), 'evt_01HZY0K7M3QF8VN2J5RX9TB4CE')

    expect(await streamMessageCount()).toBe(2)
  })

  // Dedup is keyed on the id alone, not (subject, id) — worth pinning, because a reader could
  // reasonably assume a per-subject window and build a same-id-different-subject flow on it.
  it('dedups on the msg-id alone, across different subjects', async () => {
    await publish(postCreated(COMMUNITY), 'evt_01HZY0K7M3QF8VN2J5RX9TB4CF')
    await publish(voteCast(OTHER), 'evt_01HZY0K7M3QF8VN2J5RX9TB4CF')

    expect(await streamMessageCount()).toBe(1)
  })
})

describe.skipIf(!fx)('ensureConsumer binds the durable filters the fan-out relies on', () => {
  const DURABLE = 'qaroom-connection-spec-fanout'

  beforeEach(freshStream)

  it('creates the durable with exactly the committed filter subjects', async () => {
    await ensureConsumer(
      { connection: nc, js: jetstream(nc), close: () => Promise.resolve() },
      { stream: QAROOM_STREAM, durable: DURABLE, filterSubjects: ALL_FEED_SUBJECTS },
    )
    const info = await (await jetstreamManager(nc)).consumers.info(QAROOM_STREAM, DURABLE)
    expect(info.config.filter_subjects).toEqual(ALL_FEED_SUBJECTS)
  })

  // Real JetStream rejects filter sets it considers malformed (overlapping filters, a non-terminal
  // `>`). Nothing checked the COMMITTED set was acceptable to a real server — only that QARoom's
  // own matcher liked it.
  it('accepts the committed feed filter set (a real server would reject an overlapping one)', async () => {
    await expect(
      ensureConsumer(
        { connection: nc, js: jetstream(nc), close: () => Promise.resolve() },
        { stream: QAROOM_STREAM, durable: `${DURABLE}-accepts`, filterSubjects: ALL_FEED_SUBJECTS },
      ),
    ).resolves.toBeUndefined()
  })

  it('is idempotent: re-adding an existing durable does not throw', async () => {
    const handle = { connection: nc, js: jetstream(nc), close: () => Promise.resolve() }
    const opts = { stream: QAROOM_STREAM, durable: `${DURABLE}-twice`, filterSubjects: [] }
    await ensureConsumer(handle, opts)
    await expect(ensureConsumer(handle, opts)).resolves.toBeUndefined()
  })
})

/**
 * The cross-check that closes the shared-oracle risk: for each candidate subject, what the REAL
 * server delivers to a durable bound to `ALL_FEED_SUBJECTS` must equal what `subjectMatchesFilter`
 * predicts. Every routing spec in the repo (webhooks, gateway, content seam) and the in-memory
 * broker assert against the prediction; this is the only place it meets the ground truth.
 */
describe.skipIf(!fx)('subjectMatchesFilter agrees with real JetStream routing', () => {
  const DURABLE = 'qaroom-connection-spec-routing'
  const CANDIDATES = [
    postCreated(COMMUNITY),
    postCreated(OTHER),
    voteCast(COMMUNITY),
    donationStateChanged(COMMUNITY),
    // identity's user.erased IS in the feed set; a same-shaped subject that is not published by
    // any producer sits just outside it — both are useful ground truth for the matcher.
    userErased(COMMUNITY),
    'qaroom.identity.session.comm_01HZY0K7M3QF8VN2J5RX9TB4CD.created',
    'qaroom.gateway.events.comm_01HZY0K7M3QF8VN2J5RX9TB4CD.push',
  ]

  const predicted = CANDIDATES.filter((subject) =>
    ALL_FEED_SUBJECTS.some((filter) => subjectMatchesFilter(filter, subject)),
  ).sort()

  it('delivers exactly the subjects the matcher predicts, no more and no fewer', async () => {
    await freshStream()
    await ensureConsumer(
      { connection: nc, js: jetstream(nc), close: () => Promise.resolve() },
      { stream: QAROOM_STREAM, durable: DURABLE, filterSubjects: ALL_FEED_SUBJECTS },
    )

    await Promise.all(CANDIDATES.map((subject, i) => publish(subject, `evt_routing_${i}`)))

    const consumer = await jetstream(nc).consumers.get(QAROOM_STREAM, DURABLE)
    const batch = await consumer.fetch({ max_messages: CANDIDATES.length, expires: 3_000 })
    const delivered: string[] = []
    for await (const message of batch) {
      delivered.push(message.subject)
      message.ack()
    }

    expect(delivered.sort()).toEqual(predicted)
  })

  // If the candidate list ever narrowed to only-matching or only-non-matching subjects, the
  // assertion above would still pass while proving nothing about the matcher's discrimination.
  it('exercises both sides of the filter (the comparison is not vacuous)', () => {
    expect(predicted.length).toBeGreaterThan(0)
    expect(predicted.length).toBeLessThan(CANDIDATES.length)
  })
})
