import { PGlite } from '@electric-sql/pglite'
import { COMM_GENERAL, composeMigrations, postCreated } from '@qaroom/contracts'
import { startInMemoryTelemetry, trace } from '@qaroom/otel'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { describe, expect, it } from 'vitest'
import { MESSAGING_MIGRATIONS } from './migrations'
import { outboxPublish } from './outbox'
import { createRelay } from './relay'
import {
  type EventPublisher,
  type OutboxEvent,
  rowsOf,
  type SqlExecutor,
  type TxRunner,
} from './types'

const NOW = new Date('2026-06-03T00:00:00.000Z')
const clock = { now: () => NOW }

async function freshMessagingDb(): Promise<SqlExecutor & TxRunner> {
  const db = drizzle(new PGlite()) as unknown as SqlExecutor & TxRunner
  await composeMigrations(MESSAGING_MIGRATIONS).up(db)
  return db
}

function recordingPublisher() {
  const published: Array<{ subject: string; payload: unknown; headers: Record<string, string> }> =
    []
  const publisher: EventPublisher = {
    async publish(subject, payload, headers) {
      published.push({ subject, payload, headers })
    },
  }
  return { publisher, published }
}

const sampleEvent = (eventId: string): OutboxEvent => ({
  eventId,
  subject: postCreated(COMM_GENERAL),
  eventName: 'post.created',
  eventVersion: 1,
  communityId: COMM_GENERAL,
  payload: { hello: 'world' },
})

describe('the outbox relay publishes each row once and marks it published', () => {
  it('drains an unpublished row, sets its Nats-Msg-Id, and does not re-drain it', async () => {
    const db = await freshMessagingDb()
    await outboxPublish(db, sampleEvent('evt_00000000000000000000000001'), NOW)
    const { publisher, published } = recordingPublisher()
    const relay = createRelay({ db, publisher, clock })

    const first = await relay.drainOnce()
    const second = await relay.drainOnce()

    expect(first).toBe(1)
    expect(second).toBe(0)
    expect(published).toHaveLength(1)
    expect(published[0]?.headers['Nats-Msg-Id']).toBe('evt_00000000000000000000000001')
    expect(published[0]?.subject).toBe(postCreated(COMM_GENERAL))
  })
})

describe('the outbox relay is at-least-once: a failed publish is retried, never lost', () => {
  it('leaves the row pending and bumps attempts on broker failure, then publishes on retry', async () => {
    const db = await freshMessagingDb()
    await outboxPublish(db, sampleEvent('evt_00000000000000000000000002'), NOW)
    const failing: EventPublisher = {
      async publish() {
        throw new Error('broker unavailable')
      },
    }

    const failed = await createRelay({ db, publisher: failing, clock }).drainOnce()
    expect(failed).toBe(0)
    const pending = rowsOf<{ attempts: number; published_at: string | null }>(
      await db.execute(
        sql`SELECT attempts, published_at FROM outbox WHERE id = 'evt_00000000000000000000000002'`,
      ),
    )[0]
    expect(pending?.attempts).toBe(1)
    expect(pending?.published_at).toBeNull()

    const { publisher, published } = recordingPublisher()
    const retried = await createRelay({ db, publisher, clock }).drainOnce()
    expect(retried).toBe(1)
    expect(published).toHaveLength(1)
  })
})

describe('the relay carries the enqueue-time trace context through to publish', () => {
  it('publishes with the traceparent captured when the event was written to the outbox', async () => {
    const db = await freshMessagingDb()
    const telemetry = startInMemoryTelemetry()
    await trace.getTracer('test').startActiveSpan('create-post', async (span) => {
      await outboxPublish(db, sampleEvent('evt_00000000000000000000000003'), NOW)
      span.end()
    })

    const { publisher, published } = recordingPublisher()
    await createRelay({ db, publisher, clock }).drainOnce()

    expect(published[0]?.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/)
    await telemetry.shutdown()
  })
})
