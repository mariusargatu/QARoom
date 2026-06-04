import websocketPlugin from '@fastify/websocket'
import { CommunityId } from '@qaroom/contracts'
import { problem } from '@qaroom/service-kit'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { GatewayRouteDeps } from './deps'
import { cursorFromQuery } from './event-stream'

/**
 * The WebSocket upgrade endpoint with short-lived ticket auth (Milestone 5, ADR-0013).
 *
 * The client opens `GET /ws?community=<id>` with `Sec-WebSocket-Protocol: ticket.<ticket>`.
 * Validation happens in a `preValidation` hook that runs BEFORE the protocol upgrade, so a bad
 * ticket fails the HTTP handshake with an RFC 7807 401 and the socket is never upgraded:
 *   - missing/malformed subprotocol → 401 `ws-ticket-missing`
 *   - unknown / expired / already-redeemed ticket → 401 `ws-ticket-invalid` (redeemed here, one-use)
 *   - the principal is not a member of the requested community → 403 `ws-not-a-member`
 * On success the connection streams every envelope for that community (backlog after the
 * optional `after` cursor, then live), the same envelopes the polling endpoint serves.
 */
const PROTO_PREFIX = 'ticket.'

function ticketFromProtocol(req: FastifyRequest): string {
  const raw = req.headers['sec-websocket-protocol']
  const value = Array.isArray(raw) ? raw[0] : raw
  const proto = value
    ?.split(',')
    .map((s: string) => s.trim())
    .find((p: string) => p.startsWith(PROTO_PREFIX))
  if (!proto) {
    throw problem({
      slug: 'ws-ticket-missing',
      title: 'Authentication failed',
      status: 401,
      failure_domain: 'authentication',
      detail: 'Present a ticket in the Sec-WebSocket-Protocol header as `ticket.<ticket>`.',
      retryable: false,
    })
  }
  return proto.slice(PROTO_PREFIX.length)
}

function requestedCommunity(req: FastifyRequest): string {
  return CommunityId.parse((req.query as { community?: string }).community ?? '')
}

export function registerWsUpgrade(app: FastifyInstance, deps: GatewayRouteDeps): void {
  // Encapsulate so the websocket plugin is loaded (awaited) BEFORE the /ws route is added —
  // otherwise the route is treated as a plain GET and the handler receives (request, reply).
  void app.register(async (instance) => {
    await instance.register(websocketPlugin)
    registerWsRoute(instance, deps)
  })
}

function registerWsRoute(app: FastifyInstance, deps: GatewayRouteDeps): void {
  app.get(
    '/ws',
    {
      websocket: true,
      preValidation: async (req) => {
        const ticket = ticketFromProtocol(req)
        const principal = await deps.tickets.redeem(ticket)
        if (!principal) {
          throw problem({
            slug: 'ws-ticket-invalid',
            title: 'Authentication failed',
            status: 401,
            failure_domain: 'authentication',
            detail: 'The ticket is unknown, expired, or already redeemed.',
            retryable: false,
          })
        }
        const communityId = requestedCommunity(req)
        if (!principal.memberships.some((m) => m.community_id === communityId)) {
          throw problem({
            slug: 'ws-not-a-member',
            title: 'Not a member of this community',
            status: 403,
            failure_domain: 'authorization',
            detail: 'The authenticated principal is not a member of the requested community.',
            retryable: false,
          })
        }
      },
    },
    (socket, req) => {
      const communityId = requestedCommunity(req)
      const after = cursorFromQuery(req.query as { after?: string })
      // Replay any backlog after the cursor, then stream live envelopes.
      for (const envelope of deps.eventStream.since(communityId, after)) {
        socket.send(JSON.stringify(envelope))
      }
      const unsubscribe = deps.eventStream.subscribe(communityId, (envelope) => {
        socket.send(JSON.stringify(envelope))
      })
      socket.on('close', unsubscribe)
    },
  )
}
