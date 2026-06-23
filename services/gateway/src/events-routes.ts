import { CommunityId, EventPage } from '@qaroom/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { GatewayRouteDeps } from './deps'

/**
 * The polling fallback for the WebSocket push stream (Commitment 11). `GET
 * /api/communities/:cid/events?after=<seq>` returns the same envelopes the WS connection would
 * push for that window, so a client without WebSocket support is never blind to an event. The
 * parity test asserts the two paths return identical sequences.
 *
 * ACCESS CONTROL — KNOWN GAP (REST edge auth is Milestone 13, deferred). The WS upgrade
 * (`ws-upgrade.ts`) enforces ticket auth AND community membership (403 `ws-not-a-member`); this
 * polling path performs NO authentication or membership check. The "parity" with the WS stream is
 * DATA-SHAPE parity (identical envelopes), NOT access-control parity — so `ws-not-a-member` must
 * not be presented as an enforced cross-tenant isolation control while this path is open. Closing
 * it needs a REST edge-auth primitive: the one-use WS ticket does not fit repeated polling. The gap
 * is tracked in the test ledger as a pending marker (`it.todo` in tests/ws-and-polling.spec.ts), not
 * prose alone, so a future implementer inherits the polling analogue of the ws-not-a-member test.
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
