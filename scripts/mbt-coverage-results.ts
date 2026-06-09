import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { foldRunner } from './lib/fold-runner'

/**
 * Fold the MBT all-transitions coverage run into the frozen test-results/summary.json envelope
 * as an `mbt-edge-coverage` runner. The schema is do-not-touch; coverage rides its extensible
 * `output`. Numbers come from the artifacts the two specs write while RUNNING against the live
 * service (execution evidence) — never re-derived statically from the machine, which would
 * report a model fact dressed up as a coverage fact. Run after the flags suite:
 *   pnpm --filter @qaroom/flags test && pnpm mbt:results
 */
const ROOT = process.cwd()
const summaryPath = resolve(ROOT, 'test-results/summary.json')
const coveragePath = resolve(ROOT, 'test-results/mbt-edge-coverage.json')
const pbtPath = resolve(ROOT, 'test-results/mbt-edge-coverage-pbt.json')
const illegalPath = resolve(ROOT, 'test-results/mbt-illegal-pairs.json')

interface EdgeArtifact {
  edges_total: number
  edges_covered: number
  edge_coverage_pct: number
  gap: Array<{ from: string; event: string; to: string }>
  vertices_total?: number
  vertices_covered?: number
}

interface IllegalPairsArtifact {
  pairs_total: number
  pairs_probed: number
  gap: string[]
}

function readArtifact<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

const coverage = readArtifact<EdgeArtifact>(coveragePath)
if (coverage === undefined) {
  process.stderr.write(`missing ${coveragePath} — run the flags mbt suite first\n`)
  process.exit(1)
}
const pbt = readArtifact<EdgeArtifact>(pbtPath)
const illegal = readArtifact<IllegalPairsArtifact>(illegalPath)

const complete =
  coverage.edges_covered === coverage.edges_total &&
  (illegal === undefined || illegal.pairs_probed === illegal.pairs_total)

const runner = {
  name: 'mbt-edge-coverage',
  passed: complete ? 1 : 0,
  failed: complete ? 0 : 1,
  skipped: 0,
  duration_ms: 0,
  output: {
    runner: 'mbt-edge-coverage',
    machine: 'rollout',
    criterion: 'all-transitions (0-switch)',
    edge_coverage: `${coverage.edges_covered}/${coverage.edges_total}`,
    edge_coverage_pct: coverage.edge_coverage_pct,
    vertex_coverage: `${coverage.vertices_covered ?? 0}/${coverage.vertices_total ?? 0}`,
    gap_edges: coverage.gap.map((e) => `${e.from}|${e.event}|${e.to}`),
    edges_covered_pbt_walk: pbt?.edges_covered ?? 0,
    illegal_pairs: `${illegal?.pairs_probed ?? 0}/${illegal?.pairs_total ?? 0}`,
  },
  seeds: { fastcheck: Number(process.env.VITEST_SEED ?? 0xc0ffee) },
}

foldRunner(summaryPath, runner)
process.stdout.write(
  `merged mbt-edge-coverage runner into summary.json — edge coverage ${coverage.edges_covered}/${coverage.edges_total}\n`,
)
process.exit(complete ? 0 : 1)
