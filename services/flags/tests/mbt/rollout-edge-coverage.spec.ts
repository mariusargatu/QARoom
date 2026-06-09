import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolloutMachine } from '@qaroom/contracts'
import {
  allEdges,
  coverageReport,
  edgeKey,
  edgeRecorder,
  edgesOfPaths,
  type GeneratedStep,
  modeledStates,
  shortestPaths,
} from '@qaroom/testing-utils/mbt'
import { afterAll, describe, expect, it } from 'vitest'
import { nextKey, withFlagsCtx } from '../harness'
import { ROLLOUT_URL } from './commands'

/**
 * Phase 2 — all-transitions coverage (the 0-switch criterion). `rollout.mbt.spec.ts` already
 * replays every shortest path on every PR, but shortest paths cross only the 4 forward edges:
 * the 3 back-to-`Off` edges are structurally invisible to both path generators (a return to a
 * visited state is on no shortest path and makes a path non-simple). This spec owns ONLY the
 * delta: compute the gap against the machine's declared edge set, drive each gap edge
 * deterministically (route to its source state, fire the one event, check the echoed state —
 * the endpoint's echo is a reliable "status message", so this is a complete checking sequence:
 * it detects output faults AND transfer faults), and assert the union reaches 7/7.
 */

const PATHS = shortestPaths(rolloutMachine, { maxDepth: 10 })
const EDGES = allEdges(rolloutMachine)
const PATH_EDGES = edgesOfPaths(PATHS, 'Off')
const GAP = coverageReport(EDGES, PATH_EDGES).gap

const gapFill = edgeRecorder()

/** Steps of a shortest path ending in `state` — the deterministic route for a gap edge's source. */
function routeTo(state: string): GeneratedStep[] {
  const path = PATHS.find((p) => p.target === JSON.stringify(state))
  return (path ?? { steps: [] }).steps
}

const ARTIFACT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../test-results/mbt-edge-coverage.json',
)

// The authoritative coverage artifact — execution evidence (recorded edges), never re-derived
// statically from the machine. scripts/mbt-coverage-results.ts folds it into summary.json.
afterAll(() => {
  const union = new Set([...PATH_EDGES, ...gapFill.covered()])
  const report = coverageReport(EDGES, union)
  const touched = new Set(['Off', ...[...union].flatMap((k) => [k.split('|')[0], k.split('|')[2]])])
  mkdirSync(dirname(ARTIFACT), { recursive: true })
  writeFileSync(
    ARTIFACT,
    `${JSON.stringify(
      {
        runner: 'mbt-edge-coverage',
        ...report,
        vertices_total: modeledStates(rolloutMachine).length,
        vertices_covered: modeledStates(rolloutMachine).filter((s) => touched.has(s)).length,
      },
      null,
      2,
    )}\n`,
  )
})

describe('all-transitions coverage of the rollout machine', () => {
  it('shortest paths reach every state yet leave exactly the three back-edges uncovered', () => {
    expect(PATH_EDGES.size).toBe(4)
    expect(GAP.map(edgeKey).sort()).toEqual([
      'Canary|RolloutAborted|Off',
      'Disabling|DisableCompleted|Off',
      'Enabling|RolloutAborted|Off',
    ])
  })

  it.each(
    GAP.map((edge) => ({ edge, name: edgeKey(edge) })),
  )('gap edge driven deterministically against the live service: $name', async ({ edge }) => {
    await withFlagsCtx(async (ctx) => {
      // Transition tour with per-step status check: walk the shortest route to the edge's
      // source state, verifying the echoed state at every step, then fire the gap event.
      for (const step of routeTo(edge.from)) {
        const res = await ctx.request.post(
          ROLLOUT_URL,
          { event: step.event },
          { 'idempotency-key': nextKey() },
        )
        expect(res.status).toBe(200)
        expect((res.json as { state?: string }).state).toBe(JSON.parse(step.state))
      }
      const fired = await ctx.request.post(
        ROLLOUT_URL,
        { event: edge.event },
        { 'idempotency-key': nextKey() },
      )
      expect(fired.status).toBe(200)
      expect((fired.json as { state?: string }).state).toBe(edge.to)
      gapFill.record(edge)
    })
  })

  it('path edges united with the gap-fill achieve all-transitions: 7/7 edges, 5/5 vertices', () => {
    const union = new Set([...PATH_EDGES, ...gapFill.covered()])
    const report = coverageReport(EDGES, union)
    expect(report.edges_total).toBe(7)
    expect(report.edges_covered).toBe(7)
    expect(report.edge_coverage_pct).toBe(100)
    expect(report.gap).toEqual([])
  })
})
