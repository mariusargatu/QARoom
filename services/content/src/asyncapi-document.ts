import { POST_CREATED_ADDRESS, VOTE_CAST_ADDRESS } from '@qaroom/contracts'
import { buildServiceAsyncApiYaml } from '@qaroom/service-kit'

/**
 * content-service AsyncAPI document. Single source for the committed `asyncapi.yaml`; the
 * drift gate (`pnpm asyncapi:verify`) regenerates from this and fails on any difference,
 * the async mirror of the OpenAPI drift gate (Commitment 3 / ADR-0002).
 */
export function contentAsyncApiYaml(): string {
  return buildServiceAsyncApiYaml(
    {
      title: 'QARoom content-service events',
      version: '0.0.0',
      description: 'Events content-service publishes to NATS JetStream (Milestone 4).',
    },
    [
      {
        id: 'postCreated',
        address: POST_CREATED_ADDRESS,
        operationId: 'publishPostCreated',
        action: 'send',
        messageName: 'PostCreatedEvent',
        summary: 'A post was created in a community',
        description: 'Emitted after a post commits; the Nats-Msg-Id is the event id (evt_<ulid>).',
      },
      {
        id: 'voteCast',
        address: VOTE_CAST_ADDRESS,
        operationId: 'publishVoteCast',
        action: 'send',
        messageName: 'VoteCastEvent',
        summary: 'A vote was cast on a post',
        description: 'Emitted after a vote commits; carries the recomputed post score.',
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
