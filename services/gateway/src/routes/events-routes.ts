import { CommunityId, EventPage } from '@qaroom/contracts'
import { problem } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { GatewayRouteDeps } from '../deps'

/**
 * The polling fallback for the WebSocket push stream (Commitment 11). `GET
 * /api/communities/:cid/events?after=<seq>` returns the same envelopes the WS connection would
 * push for that window, so a client without WebSocket support is never blind to an event. The
 * parity test asserts the two paths return identical sequences.
 *
 * ACCESS CONTROL (ADR-0025, superseding ADR-0022's "REST edge unauthenticated, deferred to M13").
 * This path now enforces the SAME isolation as the WS upgrade: a bearer access token is verified at
 * the edge (401 on missing/invalid/expired), and the requested community must appear in the token's
 * `memberships` or the read is refused (403 `not-a-member`) — the polling analogue of the WS path's
 * `ws-not-a-member`. So the parity with the WS stream is now BOTH data-shape AND access-control. A
 * reusable JWT (not the one-use WS ticket) is what makes this fit repeated polling.
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
      // Edge access control (ADR-0025). Verify the bearer token first (throws RFC 7807 401 on
      // missing/invalid/expired), then require membership of the requested community — the polling
      // analogue of the WS upgrade's `ws-not-a-member` 403.
      const claims = await deps.verifyToken.verify(req.headers.authorization)
      // Deliberate-bug toggle (falsifiable claim `events-polling-membership`): when set, SKIP the
      // membership check so an authenticated non-member can read another tenant's stream — the
      // cross-tenant leak the claim's gate catches. Strict === '1' like every toggle. Off in normal use.
      const skipMembershipBug = process.env.GATEWAY_BUG_SKIP_EVENTS_AUTHZ === '1'
      if (!skipMembershipBug && !claims.memberships.some((m) => m.community_id === communityId)) {
        throw problem({
          slug: 'not-a-member',
          title: 'Not a member of this community',
          status: 403,
          failure_domain: 'authorization',
          detail: 'The access token does not carry a membership for this community.',
          retryable: false,
        })
      }
      const after = AfterCursor.parse((req.query as { after?: string }).after)
      const events = deps.eventStream.since(communityId, after)
      const cursor = events.length > 0 ? (events[events.length - 1]?.seq ?? after) : after
      const page = EventPage.parse({ community_id: communityId, events, cursor })
      // Deliberate contract-drift toggle: when set, the gateway drops the `cursor` field from the
      // page it shapes here — response-contract drift on a read endpoint. `cursor` is required (and
      // additionalProperties:false) in the gateway's published EventPage schema, so the drift is the
      // bug the contract layer (Schemathesis response-schema validation, Pact/Pact-OAS) defends.
      // Read per call. Off in normal use.
      const contractDriftBug = process.env.GATEWAY_BUG_DROP_EVENT_CURSOR === '1'
      reply
        .code(200)
        .send(contractDriftBug ? { community_id: page.community_id, events: page.events } : page)
    },
  )
}
