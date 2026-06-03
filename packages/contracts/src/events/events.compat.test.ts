import { describe, expect, it } from 'vitest'
import { PostCreatedEvent } from './post-created'
import { PostCreatedEventV1 } from './post-created.v1'
import { VoteCastEvent } from './vote-cast'
import { VoteCastEventV1 } from './vote-cast.v1'

// Canonical samples built to the LIVE schema — i.e., what a current producer emits.
const currentPostCreated = PostCreatedEvent.parse({
  event_id: 'evt_00000000000000000000000000',
  post_id: 'post_00000000000000000000000000',
  community_id: 'comm_00000000000000000000000000',
  author_id: 'user_00000000000000000000000000',
  title: 'a title',
  body: 'a body',
  created_at: '2026-06-03T00:00:00.000Z',
})

const currentVoteCast = VoteCastEvent.parse({
  event_id: 'evt_00000000000000000000000001',
  post_id: 'post_00000000000000000000000000',
  community_id: 'comm_00000000000000000000000000',
  voter_id: 'user_00000000000000000000000000',
  value: 1,
  score: 1,
  cast_at: '2026-06-03T00:00:00.000Z',
})

describe('a frozen v1 consumer still parses the current producer output', () => {
  it('parses a current PostCreatedEvent under the frozen v1 schema', () => {
    expect(() => PostCreatedEventV1.parse(currentPostCreated)).not.toThrow()
  })

  it('parses a current VoteCastEvent under the frozen v1 schema', () => {
    expect(() => VoteCastEventV1.parse(currentVoteCast)).not.toThrow()
  })
})
