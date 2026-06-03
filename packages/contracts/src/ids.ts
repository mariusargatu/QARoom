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
} as const
