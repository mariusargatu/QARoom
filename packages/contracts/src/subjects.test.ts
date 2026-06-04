import { describe, expect, it } from 'vitest'
import { COMM_GENERAL } from './ids'
import {
  contentPostsForCommunity,
  donationStateChanged,
  flagStateChanged,
  parseSubject,
  postCreated,
  postsCreatedAnyCommunity,
  voteCast,
} from './subjects'

describe('subject builders place the community id at the fixed fourth position', () => {
  it('postCreated encodes the community id as the fourth segment', () => {
    const subject = postCreated(COMM_GENERAL)
    expect(subject.split('.')[3]).toBe(COMM_GENERAL)
    expect(subject).toBe(`qaroom.content.posts.${COMM_GENERAL}.created`)
  })

  it('voteCast encodes the community id as the fourth segment', () => {
    expect(voteCast(COMM_GENERAL).split('.')[3]).toBe(COMM_GENERAL)
  })

  it('builds a tenant-scoped trailing-wildcard subscription for one community', () => {
    expect(contentPostsForCommunity(COMM_GENERAL)).toBe(`qaroom.content.posts.${COMM_GENERAL}.>`)
  })

  it('flagStateChanged encodes the community id as the fourth segment', () => {
    const subject = flagStateChanged(COMM_GENERAL)
    expect(subject.split('.')[3]).toBe(COMM_GENERAL)
    expect(subject).toBe(`qaroom.flags.flag.${COMM_GENERAL}.changed`)
  })

  it('donationStateChanged encodes the community id as the fourth segment', () => {
    const subject = donationStateChanged(COMM_GENERAL)
    expect(subject.split('.')[3]).toBe(COMM_GENERAL)
    expect(subject).toBe(`qaroom.donations.donation.${COMM_GENERAL}.changed`)
  })
})

describe('parseSubject round-trips a built subject and recovers the tenant', () => {
  it('recovers service, entity, community id, and event from postCreated', () => {
    expect(parseSubject(postCreated(COMM_GENERAL))).toEqual({
      service: 'content',
      entity: 'posts',
      communityId: COMM_GENERAL,
      event: 'created',
    })
  })

  it('keeps the wildcard token for a cross-tenant subscription subject', () => {
    expect(parseSubject(postsCreatedAnyCommunity()).communityId).toBe('*')
  })
})

describe('parseSubject rejects subjects that violate the grammar', () => {
  it('throws when the position-3 segment is not a parseable community id', () => {
    expect(() => parseSubject('qaroom.content.posts.not-a-comm.created')).toThrow()
  })

  it('throws when the root token is not qaroom', () => {
    expect(() =>
      parseSubject('other.content.posts.comm_00000000000000000000000000.created'),
    ).toThrow()
  })
})
