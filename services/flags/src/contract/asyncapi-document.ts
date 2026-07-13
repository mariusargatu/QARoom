import { FLAG_STATE_CHANGED_ADDRESS } from '@qaroom/contracts'
import { buildServiceAsyncApiYaml } from '@qaroom/service-kit'

/**
 * flags-service AsyncAPI document. Single source for the committed `asyncapi.yaml`; the drift
 * gate (`pnpm asyncapi:verify`) regenerates from this and fails on any difference, the async
 * mirror of the OpenAPI drift gate (Commitment 3 / ADR-0002).
 */
export function flagsAsyncApiYaml(): string {
  return buildServiceAsyncApiYaml(
    {
      title: 'QARoom flags-service events',
      version: '0.0.0',
      description: 'Events flags-service publishes to NATS JetStream (Milestone 5).',
    },
    [
      {
        id: 'flagStateChanged',
        address: FLAG_STATE_CHANGED_ADDRESS,
        operationId: 'publishFlagStateChanged',
        action: 'send',
        messageName: 'FlagStateChangedEvent',
        summary: 'A flag rollout transitioned',
        description:
          'Emitted after a rollout transition commits; the Nats-Msg-Id is the event id (evt_<ulid>).',
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
