import { CommunityId, EventPage } from '@qaroom/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { GatewayRouteDeps } from './deps'

/**
 * The polling fallback for the WebSocket push stream (Commitment 11). `GET
 * /api/communities/:cid/events?after=<seq>` returns the same envelopes the WS connection would
 * push for that window, so a client without WebSocket support is never blind to an event. The
 * parity test asserts the two paths return identical sequences.
 */
// Strict on HTTP (a negative cursor is a client error → validation 400, matching the spec's
// minimum: 0); the WS upgrade keeps event-stream.ts's lenient cursorFromQuery — a bad query
// param there fails the handshake, not a JSON response. Fuzz finding 2026-06-10: ?after=-1
// returned 200 because the shared helper only handled NaN, despite its "clamping" comment.
const AfterCursor = z.coerce.number().int().min(0).default(0)

export function registerEventsRoute(app: FastifyInstance, deps: GatewayRouteDeps): void {
  app.get<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/events',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const after = AfterCursor.parse((req.query as { after?: string }).after)
      const events = deps.eventStream.since(communityId, after)
      const cursor = events.length > 0 ? (events[events.length - 1]?.seq ?? after) : after
      reply.code(200).send(EventPage.parse({ community_id: communityId, events, cursor }))
    },
  )
}
