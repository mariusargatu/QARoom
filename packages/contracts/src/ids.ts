import { z } from 'zod'

/**
 * Branded IDs (docs/05 §IDs, Commitment 9 seam). IDs are typed branded strings,
 * never raw `string`, and are enforced at runtime: every ID enters the system
 * through one of these Zod parsers. Prefix discriminates the type — a `UserId`
 * string cannot parse as a `PostId`. See `ids.test.ts`.
 *
 * Storage form: `<prefix>_<ULID>`, ULID = 26 Crockford base32 chars.
 */
const ULID = '[0-9A-HJKMNP-TV-Z]{26}'

/**
 * The single source for a branded-id regex. The runtime Zod parser (below) and the
 * OpenAPI path-param schema (`openapi/params.ts`) both derive their pattern from
 * here, so Schemathesis can never fuzz against an alphabet the parser disagrees with
 * (the inverted-tautology trap, docs/03 §6). A guard test pins the two paths equal.
 */
export function brandedIdPattern(prefix: string): string {
  return `^${prefix}_${ULID}$`
}

function brandedId<Brand extends string>(prefix: string, brand: Brand) {
  return z
    .string()
    .regex(new RegExp(brandedIdPattern(prefix)), `must be a ${brand} (\`${prefix}_<ulid>\`)`)
    .brand<Brand>()
    .meta({ id: brand, description: `Branded identifier: ${prefix}_<ULID>` })
}

export const UserId = brandedId('user', 'UserId')
export type UserId = z.infer<typeof UserId>

export const CommunityId = brandedId('comm', 'CommunityId')
export type CommunityId = z.infer<typeof CommunityId>

export const PostId = brandedId('post', 'PostId')
export type PostId = z.infer<typeof PostId>

export const CommentId = brandedId('cmnt', 'CommentId')
export type CommentId = z.infer<typeof CommentId>

export const DonationId = brandedId('dntn', 'DonationId')
export type DonationId = z.infer<typeof DonationId>

export const SessionId = brandedId('sess', 'SessionId')
export type SessionId = z.infer<typeof SessionId>

/**
 * Short-lived WebSocket handshake ticket id (`tkt_<ulid>`, Milestone 5). Minted by
 * identity-service on `POST /ws/tickets`, redeemed once by the gateway before the WS
 * upgrade. Branded so a ticket reference cannot be confused with a session or any
 * domain id. The ticket is a *reference*, not a JWT — its only authority is existence
 * in the (≤30s, one-use) ticket store. See ADR-0013.
 */
export const TicketId = brandedId('tkt', 'TicketId')
export type TicketId = z.infer<typeof TicketId>

/** JWT signing-key id, used as the JOSE `kid` header (Milestone 2). */
export const KeyId = brandedId('key', 'KeyId')
export type KeyId = z.infer<typeof KeyId>

/**
 * Event identifier (`evt_<ulid>`), emitted by the `IdGenerator` (Milestone 4). It doubles
 * as the NATS `Nats-Msg-Id` (JetStream `duplicate_window` dedup, Commitment 17) and as the
 * consumer-side `processed_events` key. Branded so it cannot be confused with a domain ID.
 */
export const EventId = brandedId('evt', 'EventId')
export type EventId = z.infer<typeof EventId>

/**
 * Moderation decision identifier (`mdec_<ulid>`, Milestone 9). Minted by the moderator-agent's
 * `IdGenerator` when it records a verdict for a post. Branded so a decision reference cannot be
 * confused with the post it judges or the event that carries it. It appears in the
 * `moderation.decision.recorded` event, so it is part of the cross-service contract.
 */
export const ModerationDecisionId = brandedId('mdec', 'ModerationDecisionId')
export type ModerationDecisionId = z.infer<typeof ModerationDecisionId>

/**
 * The well-known default community ("general"), seeded by the Milestone 2 migration
 * and the backfill target for Milestone 0 posts. It is a RESERVED branded id, not the
 * literal `comm_general` — that string is not 26 Crockford chars, so it cannot satisfy
 * `CommunityId.parse()`. The human-facing name lives in the `slug` ('general'); storage
 * uses this parseable id. See ADR-0007.
 */
export const COMM_GENERAL: CommunityId = CommunityId.parse('comm_00000000000000000000000000')

/**
 * Client-supplied idempotency key (HTTP `Idempotency-Key` header, Commitment 4).
 * Opaque to us; we only bound its length. Branded so it cannot be confused with
 * a domain ID.
 */
export const IdempotencyKey = z
  .string()
  .min(1)
  .max(255)
  .brand<'IdempotencyKey'>()
  .meta({ id: 'IdempotencyKey', description: 'Client-supplied Idempotency-Key header value.' })
export type IdempotencyKey = z.infer<typeof IdempotencyKey>

/** Prefix registry — single source for the prefix↔brand mapping (used by tests). */
export const ID_PREFIXES = {
  UserId: 'user',
  CommunityId: 'comm',
  PostId: 'post',
  CommentId: 'cmnt',
  DonationId: 'dntn',
  SessionId: 'sess',
  TicketId: 'tkt',
  KeyId: 'key',
  EventId: 'evt',
  ModerationDecisionId: 'mdec',
} as const
