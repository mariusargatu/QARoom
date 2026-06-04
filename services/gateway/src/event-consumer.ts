import {
  DONATIONS_FEED_SUBJECT,
  DonationStateChangedEvent,
  FLAGS_FEED_SUBJECT,
  FlagStateChangedEvent,
} from '@qaroom/contracts'
import {
  ensureConsumer,
  headersToRecord,
  type NatsHandle,
  QAROOM_STREAM,
  readEventHeaders,
} from '@qaroom/messaging'
import type { CommunityEventStream, FrameInput } from './event-stream'

/**
 * Map a consumed NATS event payload to a WS frame, or `null` if it is not a feed event. PURE
 * and unit-tested (the only part with no broker in the loop). The two QARoom flag/donation
 * event shapes are mutually exclusive, so `safeParse` discriminates without an event-name
 * header — a flag payload lacks `donation_id`, a donation payload lacks `flag_key`.
 */
export function wsFrameFor(payload: unknown): FrameInput | null {
  const flag = FlagStateChangedEvent.safeParse(payload)
  if (flag.success) {
    return {
      type: 'flag.state.changed',
      community_id: flag.data.community_id,
      occurred_at: flag.data.occurred_at,
      flag_key: flag.data.flag_key,
      state: flag.data.to_state,
      enabled: flag.data.enabled,
    }
  }
  const donation = DonationStateChangedEvent.safeParse(payload)
  if (donation.success) {
    return {
      type: 'donation.state.changed',
      community_id: donation.data.community_id,
      occurred_at: donation.data.occurred_at,
      donation_id: donation.data.donation_id,
      donor_id: donation.data.donor_id,
      amount_cents: donation.data.amount_cents,
      currency: donation.data.currency,
      status: donation.data.status,
    }
  }
  return null
}

export const WS_FEED_DURABLE = 'gateway-ws-feed'

/**
 * Integration surface (NOT unit-tested — no broker in the test loop, mirroring the
 * `@qaroom/messaging` relay). Subscribe a durable JetStream consumer over the flag/donation
 * subjects and publish each event to the in-memory `CommunityEventStream` that drives both the
 * WS push and the polling fallback. Dedup is in-memory by `Nats-Msg-Id`: the gateway is
 * stateless (no Postgres), and a duplicate frame would otherwise get a fresh `seq` and break
 * WS↔polling parity. On restart, JetStream redelivery re-warms the stream; clients reconnect
 * with their last `seq` as the `after` cursor. Returns a stop function.
 */
export async function startWsFeed(
  handle: NatsHandle,
  stream: CommunityEventStream,
): Promise<() => Promise<void>> {
  await ensureConsumer(handle, {
    stream: QAROOM_STREAM,
    durable: WS_FEED_DURABLE,
    filterSubjects: [FLAGS_FEED_SUBJECT, DONATIONS_FEED_SUBJECT],
  })

  const consumer = await handle.js.consumers.get(QAROOM_STREAM, WS_FEED_DURABLE)
  const messages = await consumer.consume()
  const seen = new Set<string>()

  const loop = (async () => {
    for await (const message of messages) {
      const { eventId } = readEventHeaders(headersToRecord(message.headers))
      if (!seen.has(eventId)) {
        seen.add(eventId)
        const frame = wsFrameFor(message.json())
        if (frame) stream.publish(frame)
      }
      message.ack()
    }
  })()

  return async () => {
    messages.stop()
    await loop
  }
}
