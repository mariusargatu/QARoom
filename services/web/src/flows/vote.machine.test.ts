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
import { voteMachine } from './vote.machine'

/**
 * Model-based coverage of the optimistic-vote flow (ADR-0027). Path generation reaches every state
 * but, exactly as for the rollout and migration machines, misses the BACK-edges — a confirmed vote
 * returning Pending->Idle and a retry Failed->Pending are on no shortest path and make any path
 * non-simple. Those are the edges that matter when a vote is confirmed late or fails. The actor
 * traversal below drives all four edges and proves 100% all-transitions coverage. NOTE: this proves
 * the MODEL is fully traversable, not that the live UI conforms — binding the machine to VoteControl
 * via reverse-conformance (like rollout.runner.ts) is a follow-up.
 */

const bothGenerators = new Set([
  ...edgesOfPaths(shortestPaths(voteMachine, { maxDepth: NIGHTLY_MAX_DEPTH }), 'Idle'),
  ...edgesOfPaths(simplePaths(voteMachine, { maxDepth: NIGHTLY_MAX_DEPTH }), 'Idle'),
])

describe('the optimistic-vote model', () => {
  it('declares exactly the four legal transitions', () => {
    expect(allEdges(voteMachine).map(edgeKey).sort()).toEqual(
      [
        'Idle|VoteCast|Pending',
        'Pending|VoteConfirmed|Idle',
        'Pending|VoteRejected|Failed',
        'Failed|VoteCast|Pending',
      ].sort(),
    )
  })

  it('generates shortest paths reaching every one of the three states', () => {
    const targets = new Set(shortestPaths(voteMachine).map((p) => p.target))
    expect(targets.size).toBe(3)
  })

  it('path generation misses exactly the two recovery back-edges', () => {
    const report = coverageReport(allEdges(voteMachine), bothGenerators)
    expect(report.edges_covered).toBe(2)
    expect(report.gap.map(edgeKey).sort()).toEqual(
      ['Failed|VoteCast|Pending', 'Pending|VoteConfirmed|Idle'].sort(),
    )
  })

  it('an actor traversal drives all four edges: cast, confirm, cast, reject, retry = 4/4', () => {
    const recorder = traverseAndRecord(voteMachine, [
      'VoteCast',
      'VoteConfirmed',
      'VoteCast',
      'VoteRejected',
      'VoteCast',
    ])
    const report = coverageReport(allEdges(voteMachine), recorder.covered())
    expect(report.edges_total).toBe(4)
    expect(report.edges_covered).toBe(4)
    expect(report.gap).toEqual([])
  })
})
