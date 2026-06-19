import {
  CommunityId,
  POST_CREATED_EVENT,
  postCreated,
  subjectMatchesFilter,
  VOTE_CAST_EVENT,
  voteCast,
} from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { classifyEventType, WEBHOOK_FEED_SUBJECTS } from '../src/consumer'

/**
 * Producer↔consumer routing guard for the webhooks fan-out (TEST-MAP wiring improvement #3),
 * asserted against the REAL `WEBHOOK_FEED_SUBJECTS` this service binds its durable to — not a
 * re-listed copy. If content's subject builders or this filter set drift apart, post.created /
 * vote.cast would silently stop reaching the fan-out; this fails in-process, per-PR, no broker.
 * Pairs with the grammar-level guarantees in contracts' `subjects.routing.test.ts`.
 */
const C = CommunityId.parse('comm_00000000000000000000000000')
const OTHER = CommunityId.parse('comm_0000000000000000000000000A')

const selectedByFanout = (subject: string): boolean =>
  WEBHOOK_FEED_SUBJECTS.some((filter) => subjectMatchesFilter(filter, subject))

describe('the webhooks durable filter selects the content events it must deliver', () => {
  it('selects post.created for any community', () => {
    expect(selectedByFanout(postCreated(C))).toBe(true)
    expect(selectedByFanout(postCreated(OTHER))).toBe(true)
  })

  it('selects vote.cast for any community', () => {
    expect(selectedByFanout(voteCast(C))).toBe(true)
    expect(selectedByFanout(voteCast(OTHER))).toBe(true)
  })

  it('does not select an event from a service it does not fan out (identity)', () => {
    expect(selectedByFanout('qaroom.identity.user.comm_00000000000000000000000000.created')).toBe(
      false,
    )
  })
})

describe("the content events' header names classify to a deliverable webhook event type", () => {
  it('classifies post.created', () => {
    expect(classifyEventType(POST_CREATED_EVENT)).toBe('post.created')
  })

  it('classifies vote.cast', () => {
    expect(classifyEventType(VOTE_CAST_EVENT)).toBe('vote.cast')
  })
})
