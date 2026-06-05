import {
  DonationStateChangedEvent,
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_DONATION_ID,
  EXAMPLE_POST_ID,
  EXAMPLE_USER_ID,
  EXAMPLE_WEBHOOK_DELIVERY_ID,
  FlagStateChangedEvent,
  ModerationDecisionRecordedEvent,
  PostCreatedEvent,
  VoteCastEvent,
  WebhookDeliveryEnvelope,
  type WebhookEventType,
} from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import type { ZodType } from 'zod'

const EVENT_ID = 'evt_01HZY0K7M3QF8VN2J5RX9TB4CP'
const WHEN = '2026-06-05T12:00:00.000Z'

/**
 * Outbound payload contract cross-check (ADR-0019 §7). QARoom is the PROVIDER of the webhook
 * delivery envelope; an external receiver is the consumer. The envelope's `data` is the unmodified
 * source event, so this asserts — for each event type — that the envelope is well-formed AND its
 * `data` validates against the matching source-event Zod schema. That makes the envelope an
 * independent second source, not a generated-only tautology: it cannot drift from the five events it
 * carries (docs/03 §6 forbids generated-only contracts).
 */
const CASES: Array<{ type: WebhookEventType; schema: ZodType; data: Record<string, unknown> }> = [
  {
    type: 'post.created',
    schema: PostCreatedEvent,
    data: {
      event_id: EVENT_ID,
      post_id: EXAMPLE_POST_ID,
      community_id: EXAMPLE_COMMUNITY_ID,
      author_id: EXAMPLE_USER_ID,
      title: 'Hello',
      body: 'World',
      created_at: WHEN,
    },
  },
  {
    type: 'flag.state.changed',
    schema: FlagStateChangedEvent,
    data: {
      event_id: EVENT_ID,
      community_id: EXAMPLE_COMMUNITY_ID,
      flag_key: 'donations',
      from_state: 'Canary',
      to_state: 'Enabled',
      rollout_event: 'RolloutCompleted',
      enabled: true,
      occurred_at: WHEN,
    },
  },
  {
    type: 'donation.state.changed',
    schema: DonationStateChangedEvent,
    data: {
      event_id: EVENT_ID,
      community_id: EXAMPLE_COMMUNITY_ID,
      donation_id: EXAMPLE_DONATION_ID,
      donor_id: EXAMPLE_USER_ID,
      amount_cents: 2500,
      currency: 'USD',
      status: 'Captured',
      occurred_at: WHEN,
    },
  },
  {
    type: 'vote.cast',
    schema: VoteCastEvent,
    data: {
      event_id: EVENT_ID,
      post_id: EXAMPLE_POST_ID,
      community_id: EXAMPLE_COMMUNITY_ID,
      voter_id: EXAMPLE_USER_ID,
      value: 1,
      score: 3,
      cast_at: WHEN,
    },
  },
  {
    type: 'moderation.decision.recorded',
    schema: ModerationDecisionRecordedEvent,
    data: {
      event_id: EVENT_ID,
      decision_id: 'mdec_01HZY0K7M3QF8VN2J5RX9TB4CR',
      post_id: EXAMPLE_POST_ID,
      community_id: EXAMPLE_COMMUNITY_ID,
      author_id: EXAMPLE_USER_ID,
      verdict: 'allow',
      rule_id: null,
      reason: 'within community rules',
      confidence: 0.92,
      model: 'gpt-x',
      occurred_at: WHEN,
    },
  },
]

describe('outbound webhook payload contract cross-check', () => {
  for (const { type, schema, data } of CASES) {
    it(`wraps a valid ${type} event the receiver can parse`, () => {
      const envelope = {
        delivery_id: EXAMPLE_WEBHOOK_DELIVERY_ID,
        event_id: EVENT_ID,
        event_type: type,
        community_id: EXAMPLE_COMMUNITY_ID,
        delivered_at: WHEN,
        data,
      }
      // The envelope is well-formed...
      expect(() => WebhookDeliveryEnvelope.parse(envelope)).not.toThrow()
      // ...and its `data` agrees with the source-event schema named by event_type.
      expect(schema.safeParse(data).success).toBe(true)
    })

    it(`would reject a ${type} payload missing a required field (the cross-check has teeth)`, () => {
      const broken = { ...data }
      delete broken.event_id
      expect(schema.safeParse(broken).success).toBe(false)
    })
  }
})
