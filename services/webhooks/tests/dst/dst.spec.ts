import { runTwiceAndDiff } from '@qaroom/testing-utils/scenario'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSimRun, runOneSeed, runSweep, seedList } from './sweep'

/**
 * In-process Deterministic Simulation Testing (DST) for the webhooks delivery edge (T20, ADR-0029).
 *
 * The full slice — one process, a virtual clock, one seed, a simulated event bus + flaky receivers,
 * a seed-driven fault menu, and an invariant checker that replays from `seed + commit`. The
 * simulation EXPLORES the delivery state space under fuzzed faults; spec/tla/WebhookDelivery.tla
 * PROVES the same safety + liveness properties exhaustively. See ./README.md for what this does and,
 * just as importantly, does NOT cover.
 *
 * The PR gate runs a MODEST sweep (default 20 seeds, env `DST_SEED_COUNT`); the dispatched nightly
 * lane runs a few thousand (`DST_SEED_COUNT=4000`). Each seed deterministically reproduces any
 * failure — the same seed twice yields a byte-identical history (the meta-test below).
 */

const SWEEP_SIZE = Number(process.env.DST_SEED_COUNT ?? 20)
const SWEEP_START = Number(process.env.DST_SEED ?? 1)
// A fixed seed whose world always contains a `down` endpoint with a delivery — so the planted-bug
// demo is robust, not luck: the failing send is guaranteed, the toggle's silent drop unmissable.
const PLANTED_SEED = 7
const META_SEED = 3

describe('webhooks DST: determinism (meta-test)', () => {
  it('replays a seed to a byte-identical history (same seed twice ⇒ same world)', async () => {
    const diff = await runTwiceAndDiff(buildSimRun(META_SEED))
    expect(diff.first.error).toBeNull()
    expect(diff.second.error).toBeNull()
    expect(diff.identical).toBe(true)
  })
})

describe('webhooks DST: invariants hold across a seed sweep', () => {
  it('liveness + at-least-once + dedup + HMAC hold, and the fault menu was exercised', async () => {
    const coverage = await runSweep(seedList(SWEEP_SIZE, SWEEP_START))

    // "Sometimes" assertions: a sim that explored nothing (no faults fired, no failures seen) would
    // pass the invariants vacuously. These make an inert simulation visible — every fault class and
    // every receiver-outcome class must have fired, and both terminal outcomes must have occurred.
    expect(coverage.terminalDelivered).toBeGreaterThan(0)
    expect(coverage.terminalDeadLettered).toBeGreaterThan(0)
    expect(coverage.sendSuccess).toBeGreaterThan(0)
    expect(coverage.sendHttpError).toBeGreaterThan(0)
    expect(coverage.sendTimeout).toBeGreaterThan(0)
    expect(coverage.sendNetworkError).toBeGreaterThan(0)
    expect(coverage.eventDuplicate).toBeGreaterThan(0)
    expect(coverage.eventRedeliver).toBeGreaterThan(0)
    expect(coverage.eventReorder).toBeGreaterThan(0)
    expect(coverage.crashMidflight).toBeGreaterThan(0)
  })
})

describe('webhooks DST: planted-bug severity proof (CHAOS_WEBHOOK_DROP_ON_FAIL)', () => {
  afterEach(() => {
    delete process.env.CHAOS_WEBHOOK_DROP_ON_FAIL
  })

  it('holds the at-least-once invariant for the seed with the toggle OFF', async () => {
    const coverage = await runOneSeed(PLANTED_SEED)
    expect(coverage.terminalDeadLettered).toBeGreaterThan(0)
  })

  it('catches the silent drop with the toggle ON (the DST version of prove --break)', async () => {
    process.env.CHAOS_WEBHOOK_DROP_ON_FAIL = '1'
    await expect(runOneSeed(PLANTED_SEED)).rejects.toThrow(/silently dropped/)
  })
})
