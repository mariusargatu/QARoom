import type { MsgHdrs } from '@nats-io/nats-core'
import { injectTraceContext } from '@qaroom/otel'
import { HEADER } from './types'

/**
 * Flatten a received NATS message's `MsgHdrs` into a plain string record — the form
 * `readEventHeaders`/`extractTraceContext` consume. Shared by `runConsumer` and any service
 * that drives the JetStream consume loop directly (e.g. the gateway's WS feed).
 */
export function headersToRecord(headers: MsgHdrs | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  for (const key of headers.keys()) {
    const value = headers.get(key)
    if (value) out[key] = value
  }
  return out
}

/**
 * Build the NATS headers for an event: `Nats-Msg-Id`, `tenant.id`, `event-name`,
 * `event-version`, plus the W3C trace carrier. The carrier defaults to the active OTel
 * context (direct publish) but is supplied by the relay (the carrier captured at enqueue)
 * so the consumer continues the originating trace. Pure and synchronous — the Pact-message
 * and trace-propagation tests assert on its output.
 */
export function buildEventHeaders(
  event: { eventId: string; eventName: string; eventVersion: number; communityId: string },
  traceCarrier: Record<string, string> = injectTraceContext({}),
): Record<string, string> {
  return {
    ...traceCarrier,
    [HEADER.msgId]: event.eventId,
    [HEADER.tenant]: event.communityId,
    [HEADER.eventName]: event.eventName,
    [HEADER.eventVersion]: String(event.eventVersion),
  }
}

/** Read the QARoom metadata back off a received message's headers (consumer side). */
export function readEventHeaders(headers: Record<string, string>): {
  eventId: string
  eventName: string
  communityId: string
} {
  return {
    eventId: headers[HEADER.msgId] ?? '',
    eventName: headers[HEADER.eventName] ?? '',
    communityId: headers[HEADER.tenant] ?? '',
  }
}
