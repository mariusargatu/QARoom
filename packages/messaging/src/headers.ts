import { injectTraceContext } from '@qaroom/otel'
import { HEADER } from './types'

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
