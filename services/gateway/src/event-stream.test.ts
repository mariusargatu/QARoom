import { COMM_GENERAL, EXAMPLE_COMMUNITY_ID } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { CommunityEventStream, cursorFromQuery, type FrameInput } from './event-stream'

const WHEN = '2026-06-05T12:00:00.000Z'

const flagFrame: FrameInput = {
  type: 'flag.state.changed',
  community_id: EXAMPLE_COMMUNITY_ID,
  occurred_at: WHEN,
  flag_key: 'donations',
  state: 'Enabled',
  enabled: true,
}

/** Build a flag frame for a specific community, reusing the shared frame shape. */
const flagFrameFor = (communityId: string): FrameInput => ({
  ...flagFrame,
  community_id: communityId,
})

/**
 * The stream is the single source both WS push and polling read from. Its publish path runs
 * inside the (un-transactional) NATS consume loop, so a throwing subscriber must never break
 * delivery to the other subscribers nor throw back into the publisher (which would skip the
 * message ack and stall the feed). These lock that resilience in with no broker in the loop.
 */
describe('CommunityEventStream.publish listener resilience', () => {
  it('still delivers to healthy listeners when one listener throws', () => {
    const stream = new CommunityEventStream()
    const healthy: number[] = []
    stream.subscribe(EXAMPLE_COMMUNITY_ID, () => {
      throw new Error('socket.send on a closing socket')
    })
    stream.subscribe(EXAMPLE_COMMUNITY_ID, (e) => healthy.push(e.seq))

    stream.publish(flagFrame)
    stream.publish(flagFrame)

    expect(healthy).toEqual([1, 2])
  })

  it('does not throw out of publish when a subscriber throws', () => {
    const stream = new CommunityEventStream()
    stream.subscribe(EXAMPLE_COMMUNITY_ID, () => {
      throw new Error('boom')
    })

    expect(() => stream.publish(flagFrame)).not.toThrow()
  })

  it('still records the envelope in the buffer when a subscriber throws', () => {
    const stream = new CommunityEventStream()
    stream.subscribe(EXAMPLE_COMMUNITY_ID, () => {
      throw new Error('boom')
    })

    const envelope = stream.publish(flagFrame)

    expect(stream.since(EXAMPLE_COMMUNITY_ID, 0)).toEqual([envelope])
  })
})

describe('cursorFromQuery', () => {
  it('parses a numeric after cursor', () => {
    expect(cursorFromQuery({ after: '7' })).toBe(7)
  })

  it('defaults a missing cursor to 0', () => {
    expect(cursorFromQuery({})).toBe(0)
  })

  it('clamps a non-numeric cursor to 0', () => {
    expect(cursorFromQuery({ after: 'not-a-number' })).toBe(0)
  })
})

/**
 * The per-community buffer is bounded by the constructor `cap`. Once full, the OLDEST envelope is
 * evicted — `.slice(-cap)` keeps the tail, never the head. These pin that a small cap trims from
 * the front, so a polling client that asks `since(0)` after overflow still gets the newest events.
 */
describe('CommunityEventStream cap eviction', () => {
  it('retains only the last `cap` envelopes after overflow', () => {
    const stream = new CommunityEventStream(2)
    stream.publish(flagFrame)
    stream.publish(flagFrame)
    stream.publish(flagFrame)

    expect(stream.since(EXAMPLE_COMMUNITY_ID, 0)).toHaveLength(2)
  })

  it('evicts the oldest envelopes, keeping the highest seqs', () => {
    const stream = new CommunityEventStream(2)
    stream.publish(flagFrame)
    stream.publish(flagFrame)
    stream.publish(flagFrame)

    const seqs = stream.since(EXAMPLE_COMMUNITY_ID, 0).map((e) => e.seq)
    expect(seqs).toEqual([2, 3])
  })
})

/**
 * `seq` is per-community, not a global counter. Each community advances its own monotonic cursor,
 * so two communities can each hold a `seq` of 1 at the same time. A shared counter would leak one
 * community's volume into another's cursors and fail these.
 */
describe('CommunityEventStream per-community seq isolation', () => {
  it('restarts seq at 1 independently for each community', () => {
    const stream = new CommunityEventStream()
    const first = stream.publish(flagFrameFor(EXAMPLE_COMMUNITY_ID))
    const second = stream.publish(flagFrameFor(COMM_GENERAL))

    expect([first.seq, second.seq]).toEqual([1, 1])
  })

  it('keeps each community buffer scoped to its own envelopes', () => {
    const stream = new CommunityEventStream()
    stream.publish(flagFrameFor(EXAMPLE_COMMUNITY_ID))
    stream.publish(flagFrameFor(COMM_GENERAL))

    const exampleCommunityIds = stream.since(EXAMPLE_COMMUNITY_ID, 0).map((e) => e.community_id)
    expect(exampleCommunityIds).toEqual([EXAMPLE_COMMUNITY_ID])
  })
})
