import {
  DONATION_STATE_CHANGED_ADDRESS,
  FLAG_STATE_CHANGED_ADDRESS,
  MODERATION_DECISION_RECORDED_ADDRESS,
  POST_CREATED_ADDRESS,
  VOTE_CAST_ADDRESS,
} from '@qaroom/contracts'
import { buildServiceAsyncApiYaml } from '@qaroom/service-kit'

/**
 * webhooks-service AsyncAPI document. webhooks is a PURE CONSUMER — it RECEIVES all five QARoom
 * domain events to fan them out to external subscribers, and publishes nothing (no `send`
 * operation, no new subject; ADR-0019). The drift gate regenerates from this (ADR-0002); the
 * direction-aware classifier treats added fields on a `receive` channel as non-breaking for us.
 */
export function webhooksAsyncApiYaml(): string {
  return buildServiceAsyncApiYaml(
    {
      title: 'QARoom webhooks-service events',
      version: '0.0.0',
      description:
        'Events webhooks-service consumes from NATS JetStream to deliver to subscribers (Milestone 11).',
    },
    [
      {
        id: 'postCreated',
        address: POST_CREATED_ADDRESS,
        operationId: 'consumePostCreated',
        action: 'receive',
        messageName: 'PostCreatedEvent',
        summary: 'A post was created (fanned out to subscribers)',
        description: 'Consumed and delivered to subscriptions that include post.created.',
      },
      {
        id: 'voteCast',
        address: VOTE_CAST_ADDRESS,
        operationId: 'consumeVoteCast',
        action: 'receive',
        messageName: 'VoteCastEvent',
        summary: 'A vote was cast (fanned out to subscribers)',
        description: 'Consumed and delivered to subscriptions that include vote.cast.',
      },
      {
        id: 'flagStateChanged',
        address: FLAG_STATE_CHANGED_ADDRESS,
        operationId: 'consumeFlagStateChanged',
        action: 'receive',
        messageName: 'FlagStateChangedEvent',
        summary: 'A flag rollout transitioned (fanned out to subscribers)',
        description: 'Consumed and delivered to subscriptions that include flag.state.changed.',
      },
      {
        id: 'donationStateChanged',
        address: DONATION_STATE_CHANGED_ADDRESS,
        operationId: 'consumeDonationStateChanged',
        action: 'receive',
        messageName: 'DonationStateChangedEvent',
        summary: 'A donation status changed (fanned out to subscribers)',
        description: 'Consumed and delivered to subscriptions that include donation.state.changed.',
      },
      {
        id: 'moderationDecisionRecorded',
        address: MODERATION_DECISION_RECORDED_ADDRESS,
        operationId: 'consumeModerationDecisionRecorded',
        action: 'receive',
        messageName: 'ModerationDecisionRecordedEvent',
        summary: 'A moderation decision was recorded (fanned out to subscribers)',
        description:
          'Consumed and delivered to subscriptions that include moderation.decision.recorded.',
      },
    ],
    [
      {
        name: 'nats',
        host: 'nats://localhost:4222',
        protocol: 'nats',
        description: 'Local JetStream broker.',
      },
    ],
  )
}
