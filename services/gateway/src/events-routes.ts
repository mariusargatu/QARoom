import { CommunityId, EventPage } from '@qaroom/contracts'
import type { FastifyInstance } from 'fastify'
import type { GatewayRouteDeps } from './deps'
import { cursorFromQuery } from './event-stream'

/**
 * The polling fallback for the WebSocket push stream (Commitment 11). `GET
 * /api/communities/:cid/events?after=<seq>` returns the same envelopes the WS connection would
 * push for that window, so a client without WebSocket support is never blind to an event. The
 * parity test asserts the two paths return identical sequences.
 */
export function registerEventsRoute(app: FastifyInstance, deps: GatewayRouteDeps): void {
  app.get<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/events',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const after = cursorFromQuery(req.query as { after?: string })
      const events = deps.eventStream.since(communityId, after)
      const cursor = events.length > 0 ? (events[events.length - 1]?.seq ?? after) : after
      reply.code(200).send(EventPage.parse({ community_id: communityId, events, cursor }))
    },
  )
}
