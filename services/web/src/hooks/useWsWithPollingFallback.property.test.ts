import type { WsEnvelope } from '@qaroom/contracts'
import fc from 'fast-check'
import { expect, test } from 'vitest'
import { FEED_CAP, prepend } from './useWsWithPollingFallback'

// Property tests for the WS<->polling merge (ADR-0025, Commitment 11). `prepend` is the pure reducer
// both transports funnel through; the bug class it defends — the same envelope arriving on BOTH the
// socket and the poll backlog — is a property of THIS function, so it is reproduced here by writing
// the overlapping inputs down, not by driving the live cluster. The deliberate-bug toggle
// WEB_BUG_WS_NO_DEDUP (detection-matrix `ws-no-dedup`) drops the dedup; the first test goes red.

// Only `seq` drives prepend's dedup/cap, so a minimal-but-typed flag frame suffices (no Zod parse
// happens inside prepend). Per-community `seq` is monotonic + unique, so both args model that: a
// uniqueArray keyed on the value, with the two arrays free to OVERLAP (the backlog-replay case).
const frame = (seq: number): WsEnvelope =>
  ({
    type: 'flag.state.changed',
    seq,
    community_id: 'comm_0000000000000000000000000',
    occurred_at: '2026-01-01T00:00:00.000Z',
    flag_key: 'donations',
    state: 'Enabled',
    enabled: true,
  }) as WsEnvelope

const feed = fc.uniqueArray(fc.nat({ max: 40 }), { maxLength: 60 }).map((seqs) => seqs.map(frame))

// THE invariant the toggle breaks: whatever the overlap between the prior feed and the incoming
// batch, no `seq` appears twice in the merged feed — duplicate React keys / doubled rows can't occur.
test('dedupes by seq under interleaved push and poll', () => {
  fc.assert(
    fc.property(feed, feed, (prev, incoming) => {
      const merged = prepend(prev, incoming)
      const seqs = merged.map((e) => e.seq)
      expect(new Set(seqs).size).toBe(seqs.length)
    }),
    { seed: 1_926_413, numRuns: 200 },
  )
})

test('caps the merged feed at FEED_CAP', () => {
  fc.assert(
    fc.property(feed, feed, (prev, incoming) => {
      expect(prepend(prev, incoming).length).toBeLessThanOrEqual(FEED_CAP)
    }),
    { seed: 5_540_028, numRuns: 200 },
  )
})

test('never fabricates an envelope outside prev or incoming', () => {
  fc.assert(
    fc.property(feed, feed, (prev, incoming) => {
      const source = new Set([...prev, ...incoming].map((e) => e.seq))
      const stray = prepend(prev, incoming).filter((e) => !source.has(e.seq))
      expect(stray).toEqual([])
    }),
    { seed: 7_811_902, numRuns: 200 },
  )
})
