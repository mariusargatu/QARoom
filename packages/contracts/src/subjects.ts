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
const MODERATOR = 'moderator'

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

/**
 * `qaroom.moderator.decision.<community_id>.recorded` — emitted when the moderator-agent records
 * a decision for a post (Milestone 9). The agent owns its decisions and proposes; it never
 * mutates content- or flags-service. A downstream review queue / notifier consumes this.
 */
export function moderationDecisionRecorded(communityId: CommunityId): string {
  return `${ROOT}.${MODERATOR}.decision.${communityId}.recorded`
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
 * The remaining entity-level feed subjects (Milestone 11). The webhooks-service fans out ALL
 * five domain events to external subscribers, so it filters at the entity level across every
 * community — these complete the set alongside `FLAGS_FEED_SUBJECT`/`DONATIONS_FEED_SUBJECT`.
 * Authored here only (the `qaroom/no-raw-nats-subject` rule).
 */
export const POSTS_FEED_SUBJECT = `${ROOT}.${CONTENT}.posts.>`
export const VOTES_FEED_SUBJECT = `${ROOT}.${CONTENT}.votes.>`
export const MODERATION_FEED_SUBJECT = `${ROOT}.${MODERATOR}.decision.>`

/**
 * The canonical fan-out set: every entity-level feed subject, in publish-grammar order. The
 * webhooks-service binds its durable to exactly this (it fans all five domain events out to external
 * subscribers). Defined ONCE here so the consumer binding and the routing/seam tests import the same
 * array instead of re-listing it — a re-listed copy silently drifts when the set changes.
 */
export const ALL_FEED_SUBJECTS: string[] = [
  POSTS_FEED_SUBJECT,
  VOTES_FEED_SUBJECT,
  FLAGS_FEED_SUBJECT,
  DONATIONS_FEED_SUBJECT,
  MODERATION_FEED_SUBJECT,
]

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
export const MODERATION_DECISION_RECORDED_ADDRESS = `${ROOT}.${MODERATOR}.decision.{community_id}.recorded`

/**
 * Does a concrete subject fall under a NATS filter subject? Implements the two JetStream
 * wildcards against the dot-tokenized grammar: `*` matches exactly one token, `>` matches one
 * or more trailing tokens (and is only legal as the final token). A `>` with nothing after it
 * is rejected — JetStream requires at least one token for `>` to match. Used by the
 * producer↔consumer routing cross-check (a service publishing `postCreated(c)` must be SELECTED
 * by every consumer's filter, e.g. `POSTS_FEED_SUBJECT` / `postsCreatedAnyCommunity()`), so a
 * community-position drift that the golden-string test would miss fails here instead.
 */
export function subjectMatchesFilter(filter: string, subject: string): boolean {
  const filterTokens = filter.split('.')
  const subjectTokens = subject.split('.')
  for (let i = 0; i < filterTokens.length; i += 1) {
    const token = filterTokens[i]
    if (token === '>') {
      // `>` is terminal and greedy: it matches the rest, but only if at least one token remains.
      return i === filterTokens.length - 1 && subjectTokens.length > i
    }
    if (i >= subjectTokens.length) return false
    if (token === '*') continue
    if (token !== subjectTokens[i]) return false
  }
  return filterTokens.length === subjectTokens.length
}

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
