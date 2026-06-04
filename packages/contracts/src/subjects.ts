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
const FLAGS = 'flags'
const DONATIONS = 'donations'

/** `qaroom.content.posts.<community_id>.created` — emitted when a post is created. */
export function postCreated(communityId: CommunityId): string {
  return `${ROOT}.${CONTENT}.posts.${communityId}.created`
}

/** `qaroom.content.votes.<community_id>.cast` — emitted when a vote is cast. */
export function voteCast(communityId: CommunityId): string {
  return `${ROOT}.${CONTENT}.votes.${communityId}.cast`
}

/** `qaroom.flags.flag.<community_id>.changed` — emitted when a flag rollout transitions (Milestone 5). */
export function flagStateChanged(communityId: CommunityId): string {
  return `${ROOT}.${FLAGS}.flag.${communityId}.changed`
}

/** `qaroom.donations.donation.<community_id>.changed` — emitted when a donation's status changes (Milestone 5). */
export function donationStateChanged(communityId: CommunityId): string {
  return `${ROOT}.${DONATIONS}.donation.${communityId}.changed`
}

/** Tenant-scoped subscription: every flags event for one community (the gateway WS/poll feed). */
export function flagsForCommunity(communityId: CommunityId): string {
  return `${ROOT}.${FLAGS}.flag.${communityId}.>`
}

/** Tenant-scoped subscription: every donations event for one community. */
export function donationsForCommunity(communityId: CommunityId): string {
  return `${ROOT}.${DONATIONS}.donation.${communityId}.>`
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
 * Cross-community entity-level filter subjects (Milestone 5). The gateway's WebSocket/poll feed
 * consumer subscribes to ALL communities' flag/donation changes, so it filters at the entity
 * level (`community_id` wildcarded). Built here so call sites never author a raw `qaroom.*`
 * literal (the `qaroom/no-raw-nats-subject` rule).
 */
export const FLAGS_FEED_SUBJECT = `${ROOT}.${FLAGS}.flag.>`
export const DONATIONS_FEED_SUBJECT = `${ROOT}.${DONATIONS}.donation.>`

/**
 * AsyncAPI address for the gateway's server→client WebSocket push (Milestone 5). Not a NATS
 * subject the broker routes — it documents the WS channel — but it follows the same grammar so
 * the AsyncAPI generator places `community_id` at the fixed third position.
 */
export const GATEWAY_EVENTS_ADDRESS = `${ROOT}.gateway.events.{community_id}.push`

/**
 * AsyncAPI channel addresses — the parameterized subject form with a `{community_id}`
 * placeholder at the fixed third position. The generated AsyncAPI document declares
 * `community_id` as a channel parameter; the runtime builders above fill it.
 */
export const POST_CREATED_ADDRESS = `${ROOT}.${CONTENT}.posts.{community_id}.created`
export const VOTE_CAST_ADDRESS = `${ROOT}.${CONTENT}.votes.{community_id}.cast`
export const FLAG_STATE_CHANGED_ADDRESS = `${ROOT}.${FLAGS}.flag.{community_id}.changed`
export const DONATION_STATE_CHANGED_ADDRESS = `${ROOT}.${DONATIONS}.donation.{community_id}.changed`

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
