import {
  allEdges,
  coverageReport,
  edgeKey,
  edgesOfPaths,
  NIGHTLY_MAX_DEPTH,
  shortestPaths,
  simplePaths,
  traverseAndRecord,
} from '@qaroom/testing-utils/mbt'
import { describe, expect, it } from 'vitest'
import { donationGateMachine } from './donation-gate.machine'

/**
 * Model-based coverage of the rollout-gated donation flow (ADR-0027). Six declared transitions; path
 * generation reaches every state but misses the back-edges (rolling the flag back, and a failed-then-
 * retried charge) that close the cycles. The actor traversal drives all six and proves 100%
 * all-transitions coverage — the same discipline the rollout/migration machines are held to. NOTE:
 * this proves the MODEL is fully traversable, not that the live UI conforms (binding to DonatePage
 * via reverse-conformance is a follow-up).
 */

const bothGenerators = new Set([
  ...edgesOfPaths(shortestPaths(donationGateMachine, { maxDepth: NIGHTLY_MAX_DEPTH }), 'Gated'),
  ...edgesOfPaths(simplePaths(donationGateMachine, { maxDepth: NIGHTLY_MAX_DEPTH }), 'Gated'),
])

describe('the rollout-gated donation model', () => {
  it('declares exactly the six legal transitions', () => {
    expect(allEdges(donationGateMachine).map(edgeKey).sort()).toEqual(
      [
        'Gated|RolloutEnabled|Ready',
        'Ready|RolloutDisabled|Gated',
        'Ready|DonationSubmitted|Donating',
        'Donating|DonationSucceeded|Ready',
        'Donating|DonationFailed|Failed',
        'Failed|DonationSubmitted|Donating',
      ].sort(),
    )
  })

  it('generates shortest paths reaching every one of the four states', () => {
    const targets = new Set(shortestPaths(donationGateMachine).map((p) => p.target))
    expect(targets.size).toBe(4)
  })

  it('path generation leaves the back-edges to cover', () => {
    const report = coverageReport(allEdges(donationGateMachine), bothGenerators)
    expect(report.edges_covered).toBeLessThan(6)
    expect(report.gap.map(edgeKey)).toContain('Ready|RolloutDisabled|Gated')
  })

  it('an actor traversal drives all six edges = 6/6', () => {
    const recorder = traverseAndRecord(donationGateMachine, [
      'RolloutEnabled', // Gated -> Ready
      'RolloutDisabled', // Ready -> Gated
      'RolloutEnabled', // Gated -> Ready
      'DonationSubmitted', // Ready -> Donating
      'DonationSucceeded', // Donating -> Ready
      'DonationSubmitted', // Ready -> Donating
      'DonationFailed', // Donating -> Failed
      'DonationSubmitted', // Failed -> Donating (retry)
    ])
    const report = coverageReport(allEdges(donationGateMachine), recorder.covered())
    expect(report.edges_total).toBe(6)
    expect(report.edges_covered).toBe(6)
    expect(report.gap).toEqual([])
  })
})
