import { GATEWAY_EVENTS_ADDRESS } from '@qaroom/contracts'
import { buildServiceAsyncApiYaml } from '@qaroom/service-kit'

/**
 * gateway WebSocket-push AsyncAPI document (Milestone 5, Commitment 3). Unlike the NATS
 * services, the gateway's async surface is the server→client WebSocket stream: it SENDS a
 * `WsEnvelope` per community change. The contract is committed and drift-gated alongside the
 * others; the polling-parity test guarantees the same envelopes are reachable over HTTP.
 */
export function gatewayAsyncApiYaml(): string {
  return buildServiceAsyncApiYaml(
    {
      title: 'QARoom gateway WebSocket push',
      version: '0.0.0',
      description:
        'Server→client WebSocket envelopes the gateway pushes per community (Milestone 5).',
    },
    [
      {
        id: 'communityEvents',
        address: GATEWAY_EVENTS_ADDRESS,
        operationId: 'pushCommunityEvent',
        action: 'send',
        messageName: 'WsEnvelope',
        summary: 'A flag or donation change pushed to a connected client',
        description:
          'Delivered over the authenticated WebSocket (GET /ws?community=<id>); also retrievable via GET /api/communities/{communityId}/events.',
      },
    ],
    [
      {
        name: 'websocket',
        host: 'localhost:8080',
        protocol: 'ws',
        description: 'Gateway WebSocket endpoint (/ws), ticket-authenticated.',
      },
    ],
  )
}
