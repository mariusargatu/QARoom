import type { JetStreamClient } from '@nats-io/jetstream'
import { headers as natsHeaders } from '@nats-io/nats-core'
import { traced } from '@qaroom/otel'
import type { EventPublisher } from './types'

const encoder = new TextEncoder()

/**
 * A JetStream-backed `EventPublisher`. Emits a PRODUCER span under whatever OTel context is
 * active — the relay restores the originating request context first, so the publish span
 * links into the trace that created the event. `Nats-Msg-Id` rides in `headers`, so the
 * server dedups republishes within the stream's `duplicate_window`.
 */
export function natsPublisher(js: JetStreamClient): EventPublisher {
  return {
    async publish(subject, payload, headerRecord) {
      await traced('nats.publish', async (span) => {
        span.setAttribute('messaging.system', 'nats')
        span.setAttribute('messaging.operation', 'publish')
        span.setAttribute('messaging.destination.name', subject)
        const headers = natsHeaders()
        for (const [key, value] of Object.entries(headerRecord)) headers.set(key, value)
        await js.publish(subject, encoder.encode(JSON.stringify(payload)), { headers })
      })
    },
  }
}
