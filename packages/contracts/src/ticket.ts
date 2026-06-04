import { z } from 'zod'
import { TicketId, UserId } from './ids'
import { MembershipClaim } from './session'

/**
 * WebSocket handshake-ticket contracts (Milestone 5, ADR-0013).
 *
 * A ticket is a short-lived (≤30s), one-use reference minted by identity-service for an
 * already-authenticated principal. The client presents it in the WS subprotocol
 * (`Sec-WebSocket-Protocol: ticket.<ticket>`); the gateway redeems it once via the internal
 * redeem endpoint before upgrading the connection. The ticket carries no authority itself —
 * it is a lookup key into a server-side store — so a leaked ticket is useless after its
 * single use or 30-second expiry, and (unlike a bearer token in the subprotocol) it never
 * exposes long-lived credentials in proxy/server access logs.
 */

/** Response from `POST /ws/tickets`: the ticket reference and its remaining lifetime. */
export const TicketResponse = z
  .object({
    ticket: TicketId,
    /** Seconds until the ticket expires (30 in Milestone 5). */
    expires_in_seconds: z.number().int().positive(),
  })
  .meta({ id: 'TicketResponse', description: 'A freshly minted WebSocket handshake ticket.' })
export type TicketResponse = z.infer<typeof TicketResponse>

/** Internal (gateway→identity) redeem request: consume a ticket exactly once. */
export const RedeemTicketRequest = z
  .strictObject({ ticket: TicketId })
  .meta({ id: 'RedeemTicketRequest', description: 'Body for the internal ticket redeem call.' })
export type RedeemTicketRequest = z.infer<typeof RedeemTicketRequest>

/** Redeem result: the principal the ticket was minted for, plus its memberships. */
export const RedeemTicketResponse = z
  .object({
    user_id: UserId,
    memberships: z.array(MembershipClaim),
  })
  .meta({ id: 'RedeemTicketResponse', description: 'The principal a redeemed ticket authorizes.' })
export type RedeemTicketResponse = z.infer<typeof RedeemTicketResponse>
