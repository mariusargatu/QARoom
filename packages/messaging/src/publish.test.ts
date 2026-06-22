import type { JetStreamClient } from '@nats-io/jetstream'
import type { MsgHdrs } from '@nats-io/nats-core'
import { type InMemoryTelemetry, startInMemoryTelemetry } from '@qaroom/otel'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { natsPublisher } from './publish'

// `traced` caches the module-level tracer on first use, so register ONE in-memory provider for the
// file and reset spans between tests (the consume-loop.test.ts pattern). A recording fake stands in
// for JetStream so the publisher's span + encoding contract runs without a broker.
let telemetry: InMemoryTelemetry
beforeAll(() => {
  telemetry = startInMemoryTelemetry()
})
afterAll(() => telemetry.shutdown())
beforeEach(() => {
  telemetry.exporter.reset()
})

function recordingJs() {
  const calls: Array<{ subject: string; data: Uint8Array; headers: MsgHdrs }> = []
  const js = {
    publish: async (subject: string, data: Uint8Array, opts: { headers: MsgHdrs }) => {
      calls.push({ subject, data, headers: opts.headers })
      return {}
    },
  } as unknown as JetStreamClient
  return { js, calls }
}

const decode = (data: Uint8Array) => JSON.parse(new TextDecoder().decode(data))

describe('natsPublisher publishes JSON-encoded payloads to JetStream', () => {
  it('forwards the subject and the JSON-encoded payload', async () => {
    const { js, calls } = recordingJs()
    await natsPublisher(js).publish(
      'qaroom.content.post.c1.created',
      { id: 'post_1', score: 3 },
      {},
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]?.subject).toBe('qaroom.content.post.c1.created')
    expect(decode(calls[0]?.data as Uint8Array)).toEqual({ id: 'post_1', score: 3 })
  })

  it('copies every header record entry onto the NATS headers', async () => {
    const { js, calls } = recordingJs()
    await natsPublisher(js).publish('s', {}, { 'Nats-Msg-Id': 'evt_1', 'tenant.id': 'c1' })
    const headers = calls[0]?.headers
    expect(headers?.get('Nats-Msg-Id')).toBe('evt_1')
    expect(headers?.get('tenant.id')).toBe('c1')
  })

  it('emits a nats.publish PRODUCER span with the messaging attributes', async () => {
    const { js } = recordingJs()
    await natsPublisher(js).publish('qaroom.content.post.c1.created', {}, {})
    const span = telemetry.exporter.getFinishedSpans().find((s) => s.name === 'nats.publish')
    expect(span?.attributes['messaging.system']).toBe('nats')
    expect(span?.attributes['messaging.operation']).toBe('publish')
    expect(span?.attributes['messaging.destination.name']).toBe('qaroom.content.post.c1.created')
  })
})
