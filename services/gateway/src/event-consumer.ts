import {
  DONATIONS_FEED_SUBJECT,
  DonationStateChangedEvent,
  FLAGS_FEED_SUBJECT,
  FlagStateChangedEvent,
} from '@qaroom/contracts'
import {
  consumeDurable,
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
 * with their last `seq` as the `after` cursor. The resilient consume loop (per-message span,
 * poison/transient settle, loop-death surfacing) is owned by `runResilientConsume`. Returns a
 * stop function.
 */
export async function startWsFeed(
  handle: NatsHandle,
  stream: CommunityEventStream,
): Promise<() => Promise<void>> {
  // Built in this closure BEFORE consumeDurable so the gateway owns its own dedup state.
  // `consumeDurable` folds ONLY the ensure -> get -> consume bootstrap (removing the
  // ensure-before-get footgun); the in-memory `seen` Set and the SyntaxError poison rule below
  // stay the gateway's, not the substrate's.
  const seen = new Set<string>()

  return consumeDurable(
    handle,
    {
      stream: QAROOM_STREAM,
      durable: WS_FEED_DURABLE,
      filterSubjects: [FLAGS_FEED_SUBJECT, DONATIONS_FEED_SUBJECT],
    },
    {
      spanName: 'gateway.event.process',
      loopDeathSpanName: 'gateway.feed.loop_died',
      handle: async (message) => {
        const { eventId } = readEventHeaders(headersToRecord(message.headers))
        if (!seen.has(eventId)) {
          // `message.json()` throws on an undecodable payload — a poison message. Mark seen only
          // AFTER a successful decode so a poison message we `term` does not suppress a
          // (hypothetical) later well-formed redelivery of the same id.
          const frame = wsFrameFor(message.json())
          seen.add(eventId)
          if (frame) stream.publish(frame)
        }
        message.ack()
      },
      // Poison vs transient: a payload that cannot be parsed will never succeed on redelivery, so
      // terminate it; anything else may be transient, so nak for redelivery.
      settle: (message, err) => {
        if (isPoison(err)) message.term('undecodable feed event')
        else message.nak()
      },
    },
  )
}

/**
 * A poison message is one whose payload cannot be decoded (e.g. `message.json()` on non-JSON).
 * `SyntaxError` is what `JSON.parse` throws; such a message will never decode on redelivery, so
 * it is `term`ed rather than `nak`ed. Everything else is treated as potentially transient.
 */
function isPoison(err: unknown): boolean {
  return err instanceof SyntaxError
}
