import { PGlite } from '@electric-sql/pglite'
import { COMM_GENERAL, composeMigrations, postCreated } from '@qaroom/contracts'
import { startInMemoryTelemetry, trace } from '@qaroom/otel'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

// The drain span carries the failure signal (it is the nearest LIVE span — the per-publish
// span has already ended by the time a failure is caught). OTel records an exception as a
// span event named 'exception' (semantic conventions), so we look for that on the
// `outbox.relay.drain` span the relay opens.
function drainExceptionMessages(telemetry: ReturnType<typeof startInMemoryTelemetry>): string[] {
  return telemetry.exporter
    .getFinishedSpans()
    .filter((span) => span.name === 'outbox.relay.drain')
    .flatMap((span) => span.events)
    .filter((event) => event.name === 'exception')
    .map((event) => String(event.attributes?.['exception.message'] ?? ''))
}

// One in-memory provider per file. `traced` caches the module-level tracer the first time it
// runs, so a second per-test `startInMemoryTelemetry()` would never become the active provider
// (OTel registers the global tracer provider once). Register once, reset spans between tests.
let telemetry: ReturnType<typeof startInMemoryTelemetry>
beforeAll(() => {
  telemetry = startInMemoryTelemetry()
})
afterAll(() => telemetry.shutdown())
beforeEach(() => {
  telemetry.exporter.reset()
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

describe('a failed publish is surfaced on a live span, not silently dropped', () => {
  it('records the broker exception on the outbox.relay.drain span', async () => {
    const db = await freshMessagingDb()
    await outboxPublish(db, sampleEvent('evt_00000000000000000000000004'), NOW)
    const failing: EventPublisher = {
      async publish() {
        throw new Error('broker unavailable')
      },
    }

    await createRelay({ db, publisher: failing, clock }).drainOnce()

    expect(drainExceptionMessages(telemetry)).toContain('broker unavailable')
  })
})

describe('a drain that throws (DB/NATS down) surfaces on a span before it propagates', () => {
  it('records the transaction failure on a real span rather than a no-op getActiveSpan', async () => {
    const exploding: TxRunner = {
      transaction() {
        return Promise.reject(new Error('database is down'))
      },
    } as unknown as TxRunner
    const { publisher } = recordingPublisher()
    const relay = createRelay({ db: exploding, publisher, clock })

    await expect(relay.drainOnce()).rejects.toThrow('database is down')

    expect(drainExceptionMessages(telemetry)).toContain('database is down')
  })
})

describe('the relay carries the enqueue-time trace context through to publish', () => {
  it('publishes with the traceparent captured when the event was written to the outbox', async () => {
    const db = await freshMessagingDb()
    await trace.getTracer('test').startActiveSpan('create-post', async (span) => {
      await outboxPublish(db, sampleEvent('evt_00000000000000000000000003'), NOW)
      span.end()
    })

    const { publisher, published } = recordingPublisher()
    await createRelay({ db, publisher, clock }).drainOnce()

    expect(published[0]?.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/)
  })
})
