import { POSTS_FEED_SUBJECT } from '@qaroom/contracts'
import { runTwiceAndDiff } from '@qaroom/testing-utils/scenario'
import { describe, expect, it } from 'vitest'
import { buildComposedRun, runOneSeed, runSweep, seedList } from './sweep'

/**
 * TWO-SERVICE in-process Deterministic Simulation Testing (T22, ADR-0029): content (producer) and
 * webhooks (consumer) composed in ONE process over an in-memory broker, two PGlite databases, and a
 * single virtual clock, with the moderator joining as a seeded sim consumer at the LLM kernel
 * boundary. The simulation EXPLORES the cross-service state space (events crossing the bus under
 * dedup, redelivery, and flaky receivers); the invariant checker replays any failure from
 * `seed + commit`. See ./README.md for what this covers and, just as importantly, does NOT.
 *
 * The PR gate runs a MODEST sweep (default 20 seeds, env `CROSS_DST_SEED_COUNT`); the dispatched
 * nightly lane runs 100 (`CROSS_DST_SEED_COUNT=100`). Each seed reproduces deterministically — the
 * same seed twice yields a byte-identical composed history (the meta-test below). A composed world is
 * ~2× the single-service cost (two PGlite databases per seed), so the sweep `it` carries an explicit
 * generous timeout: it is a throughput fold, not a hung-test guard.
 */

// ~1.1s per composed world (2 PGlite DBs); 20 seeds ≈ 22s, the nightly 100 ≈ 110s. Generous so a
// contended sweep host never false-times-out — a real hang still dies here, just later.
const SWEEP_TIMEOUT_MS = 240_000

const SWEEP_SIZE = Number(process.env.CROSS_DST_SEED_COUNT ?? 20)
const SWEEP_START = Number(process.env.CROSS_DST_SEED ?? 1)
// A fixed seed whose world always pins the first post.created to communityA (which always carries a
// down + a healthy subscription), so the planted dropped-publish always lands on a NOTIFYING event.
const PLANTED_SEED = 7
const META_SEED = 3

describe('cross-service DST: determinism survives the service boundary (meta-test)', () => {
  it('replays a seed to a byte-identical composed history (same seed twice ⇒ same two-service world)', async () => {
    const diff = await runTwiceAndDiff(buildComposedRun(META_SEED))
    expect(diff.first.error).toBeNull()
    expect(diff.second.error).toBeNull()
    expect(diff.identical).toBe(true)
  })
})

describe('cross-service DST: invariants hold across a seed sweep', () => {
  it(
    'no event lost or duplicated, tenant preserved, moderator consumed, HMAC binds — and the boundary was exercised',
    async () => {
      const { receiver, cross } = await runSweep(seedList(SWEEP_SIZE, SWEEP_START))

      // "Sometimes" floors: a composition that explored nothing (no events crossed, no faults fired)
      // would pass the invariants vacuously. Each guaranteed-by-the-floor outcome must have occurred.
      expect(receiver.terminalDelivered).toBeGreaterThan(0) // the healthy endpoint delivered
      expect(receiver.terminalDeadLettered).toBeGreaterThan(0) // the down endpoint dead-lettered
      expect(receiver.sendSuccess).toBeGreaterThan(0)
      expect(receiver.sendNetworkError).toBeGreaterThan(0)
      expect(cross.brokerAccepted).toBeGreaterThan(0) // events actually crossed the bus
      expect(cross.redelivered).toBeGreaterThan(0) // at-least-once redelivery was exercised
      expect(cross.decisions).toBeGreaterThan(0) // the moderator stub consumed post.created
      expect(cross.postsCreated).toBeGreaterThan(0)
      expect(cross.votesCast).toBeGreaterThan(0) // the vote.cast channel crossed too
    },
    SWEEP_TIMEOUT_MS,
  )
})

describe('cross-service DST: planted-bug proof (a dropped relay publish)', () => {
  it('holds with the broker delivering every publish (no drop)', async () => {
    const { receiver } = await runOneSeed(PLANTED_SEED)
    expect(receiver.terminalDelivered).toBeGreaterThan(0)
  })

  it('catches a silently dropped post.created — the cross-service version of prove --break', async () => {
    await expect(
      runOneSeed(PLANTED_SEED, { dropPublishOnce: [POSTS_FEED_SUBJECT] }),
    ).rejects.toThrow(/event lost across the boundary/)
  })
})
