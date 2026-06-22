import type { WsEnvelope } from '@qaroom/contracts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { FEED_CAP, prepend } from './useWsWithPollingFallback'

// Merge-dedup oracle for the feed. The hook feeds `prepend` from two transports that BOTH replay
// the same backlog (WS push with no `after` + polling from cursor 0), so the only thing keeping a
// community envelope from appearing twice — duplicate React keys + duplicated rows — is the
// dedup-by-`seq`. Nothing else in the suite asserts it, so a regression to `[...incoming, ...prev]`
// would survive every gate. These tests pin: dedup by seq, newest-first order, and the FEED_CAP cap.

// A minimal valid flag-rollout envelope keyed on `seq`. `seq` is all `prepend` reads; the rest is
// filled with contract-valid values so the test exercises real WsEnvelope objects.
const frame = (seq: number): WsEnvelope => ({
  type: 'flag.state.changed',
  seq,
  community_id: 'comm_00000000000000000000000000',
  occurred_at: '2026-01-01T00:00:00.000Z',
  flag_key: 'beta-feed',
  state: 'Enabled',
  enabled: true,
})

const seqs = (events: WsEnvelope[]): number[] => events.map((e) => e.seq)

describe('prepend (feed merge-dedup)', () => {
  it('drops envelopes whose seq is already in the feed (overlapping WS backlog + poll-from-0)', () => {
    // Feed already holds the WS backlog 3,2,1; the poll-from-cursor-0 page replays 1,2,3 (reversed
    // to newest-first by the caller). The overlap must not produce duplicate seqs.
    const existing = [frame(3), frame(2), frame(1)]
    const overlappingPoll = [frame(3), frame(2), frame(1)]

    const merged = prepend(existing, overlappingPoll)

    expect(seqs(merged)).toEqual([3, 2, 1])
    expect(new Set(seqs(merged)).size).toBe(merged.length)
  })

  it('prepends only the fresh seqs, newest-first', () => {
    const merged = prepend([frame(2), frame(1)], [frame(4), frame(3)])
    expect(seqs(merged)).toEqual([4, 3, 2, 1])
  })

  it('truncates to FEED_CAP, keeping the newest', () => {
    const incoming = Array.from({ length: 60 }, (_, i) => frame(1000 - i)) // 1000..941, newest-first
    const merged = prepend([], incoming)

    expect(merged).toHaveLength(FEED_CAP)
    expect(merged[0]?.seq).toBe(1000)
    expect(merged[FEED_CAP - 1]?.seq).toBe(1000 - (FEED_CAP - 1))
  })

  it('property: any interleaving of poll pages and socket events stays dup-free and capped', () => {
    fc.assert(
      fc.property(
        // A sequence of "incoming" batches: a poll page has unique seqs (seq is unique-per-
        // community), a socket event is a singleton. Seqs are drawn from a small pool so the
        // realistic case — overlap ACROSS transports/pages — is frequent.
        fc.array(fc.uniqueArray(fc.integer({ min: 0, max: 80 }), { maxLength: 8 }), {
          maxLength: 30,
        }),
        (batches) => {
          const feed = batches.reduce<WsEnvelope[]>(
            (acc, batch) => prepend(acc, batch.map(frame)),
            [],
          )
          const observed = seqs(feed)
          expect(new Set(observed).size).toBe(observed.length) // no duplicate seq
          expect(feed.length).toBeLessThanOrEqual(FEED_CAP) // capped
        },
      ),
    )
  })
})
