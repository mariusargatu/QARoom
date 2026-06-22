import type { MsgHdrs } from '@nats-io/nats-core'
import { startInMemoryTelemetry, trace } from '@qaroom/otel'
import { describe, expect, it } from 'vitest'
import { buildEventHeaders, headersToRecord, readEventHeaders } from './headers'
import { HEADER } from './types'

/** A minimal MsgHdrs double: only `keys()` and `get()` are exercised by headersToRecord. */
function fakeHeaders(entries: Record<string, string>): MsgHdrs {
  return {
    keys: () => Object.keys(entries),
    get: (key: string) => entries[key] ?? '',
  } as unknown as MsgHdrs
}

const SAMPLE = {
  eventId: 'evt_00000000000000000000000000',
  eventName: 'post.created',
  eventVersion: 2,
  communityId: 'comm_00000000000000000000000000',
}

describe('buildEventHeaders stamps the dedup and tenancy headers on every event', () => {
  it('sets Nats-Msg-Id to the event id (the JetStream dedup key)', () => {
    expect(buildEventHeaders(SAMPLE)[HEADER.msgId]).toBe(SAMPLE.eventId)
  })

  it('sets tenant.id, event-name, and a stringified event-version', () => {
    const headers = buildEventHeaders(SAMPLE)
    expect(headers[HEADER.tenant]).toBe(SAMPLE.communityId)
    expect(headers[HEADER.eventName]).toBe('post.created')
    expect(headers[HEADER.eventVersion]).toBe('2')
  })
})

describe('readEventHeaders recovers what a publisher stamped', () => {
  it('round-trips the event id, name, and tenant', () => {
    expect(readEventHeaders(buildEventHeaders(SAMPLE))).toEqual({
      eventId: SAMPLE.eventId,
      eventName: 'post.created',
      communityId: SAMPLE.communityId,
    })
  })
})

describe('headersToRecord flattens a received MsgHdrs into a plain record', () => {
  it('returns an empty record when no headers are present', () => {
    expect(headersToRecord(undefined)).toEqual({})
  })

  it('copies every non-empty header key/value pair', () => {
    const record = headersToRecord(
      fakeHeaders({ [HEADER.msgId]: 'evt_1', [HEADER.tenant]: 'comm_1' }),
    )
    expect(record).toEqual({ [HEADER.msgId]: 'evt_1', [HEADER.tenant]: 'comm_1' })
  })

  it('drops keys whose value is empty', () => {
    const record = headersToRecord(fakeHeaders({ [HEADER.msgId]: 'evt_1', blank: '' }))
    expect(record).toEqual({ [HEADER.msgId]: 'evt_1' })
  })
})

describe('buildEventHeaders carries W3C trace context for cross-async correlation', () => {
  it('injects a traceparent from the active span', async () => {
    const telemetry = startInMemoryTelemetry()
    const headers = trace.getTracer('test').startActiveSpan('op', (span) => {
      const built = buildEventHeaders(SAMPLE)
      span.end()
      return built
    })
    expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/)
    await telemetry.shutdown()
  })
})
