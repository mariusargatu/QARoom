import { rolloutMachine } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import {
  allEdges,
  coverageReport,
  edgeKey,
  edgeRecorder,
  edgesOfPaths,
  illegalPairs,
} from './edge-coverage'
import { NIGHTLY_MAX_DEPTH, PR_MAX_DEPTH, shortestPaths, simplePaths } from './generate-paths'

// Companion to rollout-traversal.regression.test.ts (which pins path COUNTS): this file pins
// the bridge's reason to exist — path generators reach every state yet miss the back-edges,
// so an all-transitions claim needs its own denominator and a gap-fill.

const ROLLOUT_BACK_EDGES = [
  'Enabling|RolloutAborted|Off',
  'Canary|RolloutAborted|Off',
  'Disabling|DisableCompleted|Off',
]

describe('allEdges', () => {
  it('enumerates exactly the seven declared rollout transitions', () => {
    const keys = allEdges(rolloutMachine).map(edgeKey).sort()
    expect(keys).toEqual(
      [
        'Off|EnableRequested|Enabling',
        'Enabling|CanaryConfirmed|Canary',
        'Enabling|RolloutAborted|Off',
        'Canary|RolloutCompleted|Enabled',
        'Canary|RolloutAborted|Off',
        'Enabled|DisableRequested|Disabling',
        'Disabling|DisableCompleted|Off',
      ].sort(),
    )
  })
})

describe('edgesOfPaths', () => {
  it('threads the from-state through steps and parses the JSON-quoted state names', () => {
    const covered = edgesOfPaths(shortestPaths(rolloutMachine, { maxDepth: PR_MAX_DEPTH }), 'Off')
    // Canonical form is plain names — a single raw (quoted) step.state would poison the set.
    expect(covered.has('Off|EnableRequested|Enabling')).toBe(true)
    expect(covered.has('"Off"|EnableRequested|"Enabling"')).toBe(false)
  })

  it('shortest paths reach all five states but cross only the four forward edges', () => {
    const covered = edgesOfPaths(shortestPaths(rolloutMachine, { maxDepth: PR_MAX_DEPTH }), 'Off')
    const report = coverageReport(allEdges(rolloutMachine), covered)
    expect(report.edges_covered).toBe(4)
    expect(report.gap.map(edgeKey).sort()).toEqual([...ROLLOUT_BACK_EDGES].sort())
  })

  it('simple paths ALSO miss the three back-edges (a return to Off is not a simple path)', () => {
    const covered = edgesOfPaths(
      simplePaths(rolloutMachine, { maxDepth: NIGHTLY_MAX_DEPTH }),
      'Off',
    )
    const report = coverageReport(allEdges(rolloutMachine), covered)
    expect(report.gap.map(edgeKey).sort()).toEqual([...ROLLOUT_BACK_EDGES].sort())
  })
})

describe('edgeRecorder + coverageReport', () => {
  it('reports a deliberately uncovered cyclic edge as the gap, not as covered', () => {
    const recorder = edgeRecorder()
    for (const edge of allEdges(rolloutMachine)) {
      recorder.record(edge)
    }
    const full = coverageReport(allEdges(rolloutMachine), recorder.covered())
    expect(full).toMatchObject({
      edges_total: 7,
      edges_covered: 7,
      edge_coverage_pct: 100,
      gap: [],
    })

    const partial = edgeRecorder()
    partial.record({ from: 'Off', event: 'EnableRequested', to: 'Enabling' })
    const report = coverageReport(allEdges(rolloutMachine), partial.covered())
    expect(report.edges_covered).toBe(1)
    expect(report.edge_coverage_pct).toBe(14)
    expect(report.gap).toHaveLength(6)
  })

  it('recording the same edge twice counts once', () => {
    const recorder = edgeRecorder()
    recorder.record({ from: 'Off', event: 'EnableRequested', to: 'Enabling' })
    recorder.record({ from: 'Off', event: 'EnableRequested', to: 'Enabling' })
    expect(recorder.covered().size).toBe(1)
  })

  it('enumerates exactly the 23 illegal (state, event) pairs of the rollout machine', () => {
    const pairs = illegalPairs(rolloutMachine)
    expect(pairs).toHaveLength(23) // 5 states × 6 events − 7 legal edges
    expect(pairs).toContainEqual({ state: 'Off', event: 'CanaryConfirmed' })
    expect(pairs).toContainEqual({ state: 'Enabled', event: 'EnableRequested' })
    expect(pairs).not.toContainEqual({ state: 'Off', event: 'EnableRequested' })
  })

  it('an empty edge set reports 100% vacuously', () => {
    expect(coverageReport([], new Set())).toMatchObject({
      edges_total: 0,
      edge_coverage_pct: 100,
    })
  })
})
