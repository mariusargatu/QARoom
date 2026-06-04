import { DONATION_STATE_CHANGED_ADDRESS, FLAG_STATE_CHANGED_ADDRESS } from '@qaroom/contracts'
import { buildServiceAsyncApiYaml } from '@qaroom/service-kit'

/**
 * donations-service AsyncAPI document. donations both SENDS donation-state events and RECEIVES
 * flags-service's flag-state events (to maintain its gating cache) — so the document declares
 * one `send` and one `receive` operation. The drift gate regenerates from this (ADR-0002); the
 * direction-aware classifier treats added/removed fields differently per send vs receive.
 */
export function donationsAsyncApiYaml(): string {
  return buildServiceAsyncApiYaml(
    {
      title: 'QARoom donations-service events',
      version: '0.0.0',
      description:
        'Events donations-service publishes and consumes on NATS JetStream (Milestone 5).',
    },
    [
      {
        id: 'donationStateChanged',
        address: DONATION_STATE_CHANGED_ADDRESS,
        operationId: 'publishDonationStateChanged',
        action: 'send',
        messageName: 'DonationStateChangedEvent',
        summary: "A donation's status changed",
        description:
          'Emitted after a donation commits; the Nats-Msg-Id is the event id (evt_<ulid>).',
      },
      {
        id: 'flagStateChanged',
        address: FLAG_STATE_CHANGED_ADDRESS,
        operationId: 'consumeFlagStateChanged',
        action: 'receive',
        messageName: 'FlagStateChangedEvent',
        summary: 'A flag rollout transitioned (consumed for donation gating)',
        description:
          'Consumed to keep the local flag cache current; donation gating reads that cache.',
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
