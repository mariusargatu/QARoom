import {
  CommunityId,
  donationStateChanged,
  flagStateChanged,
  postCreated,
  subjectMatchesFilter,
  voteCast,
} from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { WS_FEED_SUBJECTS, wsFrameFor } from '../src/event-consumer'

/**
 * Routing guard for the intentional gap (TEST-MAP wiring improvement #3): the gateway WS/poll feed
 * streams flag + donation changes ONLY. Content's post.created / vote.cast reach external subscribers
 * (webhooks) and the moderator, never the in-app WS stream. Asserted against the REAL
 * `WS_FEED_SUBJECTS` the durable binds to, so an edit that quietly broadens the feed to content
 * events trips here. Pairs with the producer side in webhooks' `tests/feed-routing.spec.ts`.
 */
const C = CommunityId.parse('comm_00000000000000000000000000')

const selectedByWsFeed = (subject: string): boolean =>
  WS_FEED_SUBJECTS.some((filter) => subjectMatchesFilter(filter, subject))

describe('the gateway WS feed filter selects exactly flag + donation events', () => {
  // Positive controls: without these, an all-negative suite stays green even if WS_FEED_SUBJECTS were
  // emptied to [] (a silent total feed outage), since `[].some()` is false for every subject.
  it('selects flag.state.changed', () => {
    expect(selectedByWsFeed(flagStateChanged(C))).toBe(true)
  })

  it('selects donation.state.changed', () => {
    expect(selectedByWsFeed(donationStateChanged(C))).toBe(true)
  })

  it('does not select post.created', () => {
    expect(selectedByWsFeed(postCreated(C))).toBe(false)
  })

  it('does not select vote.cast', () => {
    expect(selectedByWsFeed(voteCast(C))).toBe(false)
  })
})

describe('the WS frame mapper has no shape for content events', () => {
  it('returns null for a post-created-shaped payload (no WS frame is produced)', () => {
    const postCreatedPayload = {
      event_id: 'evt_00000000000000000000000000',
      post_id: 'post_00000000000000000000000000',
      community_id: C,
      author_id: 'user_00000000000000000000000000',
      title: 'a title',
      body: 'a body',
      created_at: '2026-06-03T00:00:00.000Z',
    }
    expect(wsFrameFor(postCreatedPayload)).toBeNull()
  })
})
