import { describe, expect, it } from 'vitest'
import { CommunityId } from './ids'
import {
  DONATIONS_FEED_SUBJECT,
  donationStateChanged,
  FLAGS_FEED_SUBJECT,
  flagStateChanged,
  POSTS_FEED_SUBJECT,
  parseSubject,
  postCreated,
  postsCreatedAnyCommunity,
  subjectMatchesFilter,
  VOTES_FEED_SUBJECT,
  voteCast,
} from './subjects'

/**
 * Producer↔consumer SUBJECT-ROUTING cross-check (TEST-MAP wiring improvement #3). The golden-string
 * test (`subjects.golden.test.ts`) pins what each builder PRODUCES; this pins that what content
 * produces is SELECTED by the filter every consumer actually subscribes with. A community-position
 * drift (subject built with the id at the wrong segment) leaves the golden string self-consistent yet
 * silently unroutable — caught here, in-process, per-PR, instead of at a live broker.
 *
 * Consumer filter sets modeled from the contracts-level constants (the real wiring):
 *  - webhooks fan-out filters on POSTS_/VOTES_/FLAGS_/DONATIONS_/MODERATION_FEED_SUBJECT
 *    (services/webhooks/src/consumer.ts `WEBHOOK_FEED_SUBJECTS`).
 *  - the moderator subscribes cross-tenant on `postsCreatedAnyCommunity()` (posts only).
 *  - the gateway WS feed filters on [FLAGS_FEED_SUBJECT, DONATIONS_FEED_SUBJECT] ONLY — it does
 *    not stream content events. The "NOT matched" cases below pin that intentional gap so a future
 *    edit that expects post/vote on the WS feed fails loudly here.
 */
const C = CommunityId.parse('comm_00000000000000000000000000')
const OTHER = CommunityId.parse('comm_0000000000000000000000000A')

describe('subjectMatchesFilter — NATS wildcard semantics', () => {
  it('matches a literal subject to itself', () => {
    expect(
      subjectMatchesFilter('qaroom.content.posts.x.created', 'qaroom.content.posts.x.created'),
    ).toBe(true)
  })

  it('* matches exactly one token, never zero and never two', () => {
    expect(
      subjectMatchesFilter('qaroom.content.posts.*.created', 'qaroom.content.posts.x.created'),
    ).toBe(true)
    expect(
      subjectMatchesFilter('qaroom.content.posts.*.created', 'qaroom.content.posts.created'),
    ).toBe(false)
    expect(
      subjectMatchesFilter('qaroom.content.posts.*.created', 'qaroom.content.posts.x.y.created'),
    ).toBe(false)
  })

  it('> matches one-or-more trailing tokens but not zero', () => {
    expect(subjectMatchesFilter('qaroom.content.posts.>', 'qaroom.content.posts.x.created')).toBe(
      true,
    )
    expect(subjectMatchesFilter('qaroom.content.posts.>', 'qaroom.content.posts.x')).toBe(true)
    expect(subjectMatchesFilter('qaroom.content.posts.>', 'qaroom.content.posts')).toBe(false)
  })

  it('rejects a different entity or service', () => {
    expect(subjectMatchesFilter('qaroom.content.posts.>', 'qaroom.content.votes.x.cast')).toBe(
      false,
    )
    expect(subjectMatchesFilter('qaroom.flags.flag.>', 'qaroom.content.posts.x.created')).toBe(
      false,
    )
  })
})

describe('content events are routed to every consumer that subscribes to them', () => {
  it('post.created is selected by the webhooks fan-out posts filter, for any community', () => {
    expect(subjectMatchesFilter(POSTS_FEED_SUBJECT, postCreated(C))).toBe(true)
    expect(subjectMatchesFilter(POSTS_FEED_SUBJECT, postCreated(OTHER))).toBe(true)
  })

  it('post.created is selected by the moderator cross-tenant wildcard, for any community', () => {
    expect(subjectMatchesFilter(postsCreatedAnyCommunity(), postCreated(C))).toBe(true)
    expect(subjectMatchesFilter(postsCreatedAnyCommunity(), postCreated(OTHER))).toBe(true)
  })

  it('vote.cast is selected by the webhooks fan-out votes filter, for any community', () => {
    expect(subjectMatchesFilter(VOTES_FEED_SUBJECT, voteCast(C))).toBe(true)
    expect(subjectMatchesFilter(VOTES_FEED_SUBJECT, voteCast(OTHER))).toBe(true)
  })

  // Positive controls for the flag/donation feeds — otherwise these two subjects appear ONLY in
  // `toBe(false)` assertions below, and a mis-authored FLAGS_/DONATIONS_FEED_SUBJECT that stops
  // matching its own event would ship green.
  it('flag.state.changed is selected by the flags feed filter', () => {
    expect(subjectMatchesFilter(FLAGS_FEED_SUBJECT, flagStateChanged(C))).toBe(true)
  })

  it('donation.state.changed is selected by the donations feed filter', () => {
    expect(subjectMatchesFilter(DONATIONS_FEED_SUBJECT, donationStateChanged(C))).toBe(true)
  })
})

describe('content events are NOT routed to consumers that must not receive them', () => {
  it('the moderator (posts only) never receives vote.cast', () => {
    expect(subjectMatchesFilter(postsCreatedAnyCommunity(), voteCast(C))).toBe(false)
  })

  it('the gateway WS feed (flags + donations only) never receives post.created or vote.cast', () => {
    expect(subjectMatchesFilter(FLAGS_FEED_SUBJECT, postCreated(C))).toBe(false)
    expect(subjectMatchesFilter(DONATIONS_FEED_SUBJECT, postCreated(C))).toBe(false)
    expect(subjectMatchesFilter(FLAGS_FEED_SUBJECT, voteCast(C))).toBe(false)
    expect(subjectMatchesFilter(DONATIONS_FEED_SUBJECT, voteCast(C))).toBe(false)
  })

  it('the webhooks posts filter never selects a vote (entity isolation)', () => {
    expect(subjectMatchesFilter(POSTS_FEED_SUBJECT, voteCast(C))).toBe(false)
  })
})

describe('a routed subject recovers the producing tenant at position 3', () => {
  it('parseSubject(postCreated(c)) recovers c — the tenant-leak guard a wildcard consumer relies on', () => {
    expect(parseSubject(postCreated(C)).communityId).toBe(C)
    expect(parseSubject(voteCast(OTHER)).communityId).toBe(OTHER)
  })

  it('a subject built with the community at the WRONG position is unroutable to the wildcard', () => {
    // What a position-drift bug would emit: the community at position 2, a literal at position 3.
    const drifted = `qaroom.content.${C}.posts.created`
    expect(subjectMatchesFilter(postsCreatedAnyCommunity(), drifted)).toBe(false)
  })

  it('the position-drifted subject also fails the parse-time tenant-leak guard', () => {
    const drifted = `qaroom.content.${C}.posts.created`
    expect(() => parseSubject(drifted)).toThrow()
  })
})
