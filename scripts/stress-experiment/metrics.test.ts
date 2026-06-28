import type { LedgerRow } from '@qaroom/promotion-ledger'
import { describe, expect, it } from 'vitest'
import {
  anchoredRatio,
  anchoredRatioDrift,
  cheatRate,
  computeMetrics,
  falseGreenRate,
  humanInterventionRate,
  plantedCheatStatus,
  timeToCulprit,
  tripsGateTargetPair,
} from './metrics'
import type { FeatureRecord } from './scenario'
import { STRESS_SCENARIO } from './scenario'

/**
 * One test per instrumented metric, proving it COMPUTES from real inputs (the T23 taxonomy / gate-guard
 * detector, the T24 promotion ledger + change classifier, the anchored-severity sources) — not a stub.
 * Each metric gets a positive AND a negative fixture, so a constant-return stub would fail.
 */

const row = (
  over: Partial<LedgerRow> & Pick<LedgerRow, 'commit_sha' | 'tier' | 'verdict'>,
): LedgerRow => ({
  evidence_hash: `h-${over.commit_sha}-${over.tier}`,
  batch_range: { from: over.commit_sha, to: over.commit_sha },
  culprit_confidence: 1,
  ts: 0,
  ...over,
})

describe('1. cheat-rate (T23 taxonomy + gate-guard gate↔target detector)', () => {
  it('counts a taxonomy attack AND a gate↔target tamper as cheats, and detects both', () => {
    const features: FeatureRecord[] = [
      { id: 'taxonomy', changedFiles: ['services/content/src/feed.ts'], attack: 'equals-true' },
      {
        id: 'tamper',
        changedFiles: [
          'scripts/deriver-conformance.ts',
          'packages/testing-utils/src/generators/vote.ts',
        ],
      },
      { id: 'honest', changedFiles: ['services/content/src/feed.ts'] },
    ]
    const r = cheatRate(features)
    expect(r.cheated).toBe(2)
    expect(r.detected).toBe(2)
    expect(r.rate).toBeCloseTo(2 / 3)
    expect(r.cheatedIds).toEqual(['taxonomy', 'tamper'])
  })

  it('a clean diff that only edits a gate (not its target) trips no pair', () => {
    expect(tripsGateTargetPair(['scripts/deriver-conformance.ts'])).toBeNull()
    expect(
      tripsGateTargetPair([
        'scripts/deriver-conformance.ts',
        'packages/testing-utils/src/generators/vote.ts',
      ]),
    ).not.toBeNull()
  })
})

describe('2. false-green rate (T24 promotion ledger)', () => {
  it('a PRESUBMIT_GREEN later RED at a higher tier is a false green; a clean climb is not', () => {
    const ledger: LedgerRow[] = [
      row({ commit_sha: 'fg', tier: 'PRESUBMIT_GREEN', verdict: 'green', ts: 1 }),
      row({ commit_sha: 'fg', tier: 'NIGHTLY_GREEN', verdict: 'red', ts: 2 }),
      row({ commit_sha: 'ok', tier: 'PRESUBMIT_GREEN', verdict: 'green', ts: 1 }),
      row({ commit_sha: 'ok', tier: 'NIGHTLY_GREEN', verdict: 'green', ts: 2 }),
    ]
    const r = falseGreenRate(ledger)
    expect(r.presubmitGreens).toBe(2)
    expect(r.falseGreens).toBe(1)
    expect(r.rate).toBeCloseTo(0.5)
    expect(r.falseGreenShas).toEqual(['fg'])
  })
})

describe('3. time-to-culprit (T24 ledger bisection, O(log n))', () => {
  it('resolves a batch red to one culprit with the full probe count and wall-time', () => {
    const ledger: LedgerRow[] = [
      row({
        commit_sha: 'batch',
        tier: 'NIGHTLY_GREEN',
        verdict: 'red',
        batch_range: { from: 'a', to: 'd' },
        culprit_confidence: 0.25,
        ts: 100,
      }),
      row({
        commit_sha: 'probe',
        tier: 'NIGHTLY_GREEN',
        verdict: 'red',
        batch_range: { from: 'a', to: 'b' },
        culprit_confidence: 0.5,
        ts: 130,
      }),
      row({
        commit_sha: 'a',
        tier: 'NIGHTLY_GREEN',
        verdict: 'red',
        batch_range: { from: 'a', to: 'a' },
        culprit_confidence: 1,
        ts: 160,
      }),
    ]
    const r = timeToCulprit(ledger)
    expect(r).toHaveLength(1)
    expect(r[0]?.culpritSha).toBe('a')
    expect(r[0]?.commits).toBe(2)
    expect(r[0]?.wallMs).toBe(60)
  })

  it('a single-commit red with no batch range yields no resolution', () => {
    const ledger: LedgerRow[] = [
      row({ commit_sha: 'x', tier: 'NIGHTLY_GREEN', verdict: 'red', ts: 1 }),
    ]
    expect(timeToCulprit(ledger)).toHaveLength(0)
  })
})

describe('4. human-intervention rate (T24 change classifier + T23 abort affordance)', () => {
  it('an event-sourced freeze-and-page and a human-flag both count; pure code does not', () => {
    const features: FeatureRecord[] = [
      { id: 'migration', changedFiles: ['services/x/src/db/migrations/0001-init.ts'] },
      { id: 'flagged', changedFiles: ['services/x/src/resolve.ts'], flaggedForHuman: true },
      { id: 'pure', changedFiles: ['services/x/src/resolve.ts'] },
    ]
    const r = humanInterventionRate(features)
    expect(r.interventions).toBe(2)
    expect(r.frozen).toBe(1)
    expect(r.flagged).toBe(1)
    expect(r.rate).toBeCloseTo(2 / 3)
    expect(r.interventionIds).toEqual(['migration', 'flagged'])
  })
})

describe('5. anchored-ratio drift (T23 anchored-severity coverage)', () => {
  it('reads the live ratio from real sources; a negative end-vs-start drift reads as erosion', () => {
    const a = anchoredRatio()
    expect(a.anchorable).toBeGreaterThan(0)
    expect(a.ratio).toBeGreaterThan(0)
    expect(a.ratio).toBeLessThanOrEqual(1)
    expect(anchoredRatioDrift(a.ratio, a.ratio).drift).toBe(0)
    const eroded = anchoredRatioDrift(0.8, 0.6)
    expect(eroded.drift).toBeCloseTo(-0.2)
    expect(eroded.eroded).toBe(true)
  })
})

describe('the planted cheat resolves to a real, reusable Tier-0 falsifier (no new claim)', () => {
  it('the scenario cheat is real theater, caught, and names a claim in the manifest', () => {
    const s = plantedCheatStatus(STRESS_SCENARIO.plantedCheat)
    expect(s.falsifierClaimId).toBe('agent-test-has-teeth')
    expect(s.falsifierResolves).toBe(true)
    expect(s.realTheater).toBe(true)
    expect(s.caught).toBe(true)
  })
})

describe('computeMetrics over the prepared scenario (end to end, real sources)', () => {
  it('produces all five metrics with the scenario name', () => {
    const m = computeMetrics(STRESS_SCENARIO)
    expect(m.scenario).toBe(STRESS_SCENARIO.name)
    expect(m.cheatRate.cheated).toBe(2)
    expect(m.falseGreen.falseGreens).toBe(1)
    expect(m.culprits).toHaveLength(1)
    expect(m.humanIntervention.interventions).toBe(3)
    expect(m.anchoredDrift.drift).toBe(0)
  })
})
