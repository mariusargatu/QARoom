import { CommunityId } from './ids'

/**
 * NATS subject taxonomy (docs/05 §3, Commitment 17). Grammar:
 *
 *   qaroom.<service>.<entity>.<community_id>.<event>
 *
 * `community_id` is fixed at position 3 — the subject IS the tenancy boundary at the
 * messaging layer, so a wildcard subscriber cannot leak across tenants by mistake. The
 * payload also carries `tenant.id`, but the subject is the load-bearing guard.
 *
 * This is the ONLY module where raw `qaroom.*` subject strings may be authored; every
 * call site uses these builders, enforced by the `qaroom/no-raw-nats-subject` lint rule
 * (Milestone 4). The root token is assembled from a constant so even this file holds no
 * literal that the rule would match.
 */
const ROOT = 'qaroom'
const CONTENT = 'content'

/** `qaroom.content.posts.<community_id>.created` — emitted when a post is created. */
export function postCreated(communityId: CommunityId): string {
  return `${ROOT}.${CONTENT}.posts.${communityId}.created`
}

/** `qaroom.content.votes.<community_id>.cast` — emitted when a vote is cast. */
export function voteCast(communityId: CommunityId): string {
  return `${ROOT}.${CONTENT}.votes.${communityId}.cast`
}

/** Tenant-scoped subscription: every content `posts` event for one community. */
export function contentPostsForCommunity(communityId: CommunityId): string {
  return `${ROOT}.${CONTENT}.posts.${communityId}.>`
}

/**
 * Cross-tenant subscription (admin tooling / the moderator agent only): `post.created`
 * across every community. A consumer of this is subject to a property test asserting it
 * handles every community correctly (docs/05 §3).
 */
export function postsCreatedAnyCommunity(): string {
  return `${ROOT}.${CONTENT}.posts.*.created`
}

/** The `>` wildcard subject reserved for service-internal JetStream stream definitions. */
export const QAROOM_STREAM_SUBJECTS = `${ROOT}.>`

/**
 * AsyncAPI channel addresses — the parameterized subject form with a `{community_id}`
 * placeholder at the fixed third position. The generated AsyncAPI document declares
 * `community_id` as a channel parameter; the runtime builders above fill it.
 */
export const POST_CREATED_ADDRESS = `${ROOT}.${CONTENT}.posts.{community_id}.created`
export const VOTE_CAST_ADDRESS = `${ROOT}.${CONTENT}.votes.{community_id}.cast`

export interface ParsedSubject {
  service: string
  entity: string
  /** Position-3 segment: a parsed `CommunityId`, or the wildcard token `*`. */
  communityId: CommunityId | '*'
  event: string
}

/**
 * Parse a subject against the grammar, enforcing `community_id` at position 3. Throws on
 * the wrong arity, a non-`qaroom` root, or a position-3 segment that is neither a wildcard
 * nor a parseable `CommunityId` — tenant-leak insurance for consumers.
 */
export function parseSubject(subject: string): ParsedSubject {
  const parts = subject.split('.')
  if (parts.length !== 5 || parts[0] !== ROOT) {
    throw new Error(
      `malformed subject (expected ${ROOT}.<service>.<entity>.<community_id>.<event>): ${subject}`,
    )
  }
  const [, service = '', entity = '', community = '', event = ''] = parts
  const communityId = community === '*' ? '*' : CommunityId.parse(community)
  return { service, entity, communityId, event }
}
