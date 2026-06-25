import { migrationMachine, rollbackMigration, runMigration } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../determinism/fake-clock'
import { allEdges, coverageReport, edgeKey, edgeRecorder, edgesOfPaths } from './edge-coverage'
import { NIGHTLY_MAX_DEPTH, shortestPaths, simplePaths } from './generate-paths'

/**
 * All-transitions coverage of the migration machine. Path generation misses BOTH
 * failure-recovery edges — `Verifying --VerificationFailed--> Pending` and
 * `RollingBack --RollbackCompleted--> Pending` return to the initial state, so they are on no
 * shortest path and make any path non-simple. Those are exactly the edges that matter when a
 * migration goes wrong. Here every machine edge is driven through the REAL runner
 * (`runMigration` / `rollbackMigration`), whose recorded transitions are the coverage evidence.
 */

const BOTH_GENERATORS = (machine: typeof migrationMachine) =>
  new Set([
    ...edgesOfPaths(shortestPaths(machine, { maxDepth: NIGHTLY_MAX_DEPTH }), 'Pending'),
    ...edgesOfPaths(simplePaths(machine, { maxDepth: NIGHTLY_MAX_DEPTH }), 'Pending'),
  ])

describe('all-transitions coverage of the migration machine', () => {
  it('path generation misses exactly the two failure-recovery edges', () => {
    const report = coverageReport(allEdges(migrationMachine), BOTH_GENERATORS(migrationMachine))
    expect(report.edges_covered).toBe(4)
    expect(report.gap.map(edgeKey).sort()).toEqual([
      'RollingBack|RollbackCompleted|Pending',
      'Verifying|VerificationFailed|Pending',
    ])
  })

  it('the real runner drives all six edges: failed verify + passing run + rollback = 6/6', async () => {
    const clock = new FakeClock()
    const recorder = edgeRecorder()
    const sink = {
      record: (t: { from: string; event: string; to: string }) =>
        recorder.record({ from: t.from, event: t.event, to: t.to }),
    }
    const noop = async () => {}

    const failed = await runMigration(
      { tx: {}, backfill: noop, verify: async () => false },
      { clock, sink, failFast: false },
    )
    expect(failed.finalState).toBe('Pending')
    expect(failed.verified).toBe(false)

    const passed = await runMigration(
      { tx: {}, backfill: noop, verify: async () => true },
      { clock, sink },
    )
    expect(passed.finalState).toBe('Done')

    const rolledBack = await rollbackMigration(
      { tx: {}, backfill: noop, verify: async () => true, rollback: noop },
      { clock, sink },
    )
    expect(rolledBack.finalState).toBe('Pending')

    const report = coverageReport(allEdges(migrationMachine), recorder.covered())
    expect(report.edges_total).toBe(6)
    expect(report.edges_covered).toBe(6)
    expect(report.gap).toEqual([])
  })
})
