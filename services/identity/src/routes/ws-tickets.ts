import { RedeemTicketRequest, RedeemTicketResponse, TicketResponse } from '@qaroom/contracts'
import { problem } from '@qaroom/service-kit'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { RouteDeps } from '../deps'
import { TICKET_TTL_SECONDS } from '../ticket-store'

/**
 * WebSocket handshake-ticket endpoints (Milestone 5, ADR-0013).
 *
 *  - `POST /ws/tickets` is authenticated with the caller's access-token JWT and mints a
 *    one-use, 30-second ticket bound to that principal. Each call returns a fresh ticket, so
 *    it is deliberately NOT idempotent and carries no Idempotency-Key.
 *  - `POST /ws/tickets/redeem` is the internal (gateway → identity) call that consumes a ticket
 *    exactly once before the gateway upgrades a WS connection. It returns the principal the
 *    ticket authorizes; an unknown, expired, or already-redeemed ticket is a 401.
 *
 * The ticket pattern is chosen over a bearer token in the WS subprotocol because subprotocol
 * values leak into proxy/server access logs; a ticket's value is bounded to ≤30s and one use.
 */
function bearerToken(req: FastifyRequest): string {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    throw problem({
      slug: 'missing-bearer-token',
      title: 'Authentication failed',
      status: 401,
      failure_domain: 'authentication',
      detail: 'A Bearer access token is required to mint a WebSocket ticket.',
      retryable: false,
    })
  }
  return header.slice('Bearer '.length)
}

export function registerWsTicketRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post('/ws/tickets', async (req, reply) => {
    const token = bearerToken(req)
    // issuer.verify throws a 401 ProblemError on a malformed, unknown-kid, or expired token.
    const claims = await deps.issuer.verify(token)
    const ticket = deps.ticketStore.issue({ userId: claims.sub, memberships: claims.memberships })
    reply.code(201).send(TicketResponse.parse({ ticket, expires_in_seconds: TICKET_TTL_SECONDS }))
  })

  app.post('/ws/tickets/redeem', async (req, reply) => {
    const { ticket } = RedeemTicketRequest.parse(req.body)
    const principal = deps.ticketStore.redeem(ticket)
    if (!principal) {
      throw problem({
        slug: 'ticket-invalid',
        title: 'Authentication failed',
        status: 401,
        failure_domain: 'authentication',
        detail: 'The ticket is unknown, expired, or already redeemed.',
        retryable: false,
      })
    }
    reply.code(200).send(
      RedeemTicketResponse.parse({
        user_id: principal.userId,
        memberships: principal.memberships,
      }),
    )
  })
}
