import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertNoDrift } from './lib/assert-no-drift'
import { computeMetrics } from './stress-experiment/metrics'
import { renderSidecar, renderStressReport } from './stress-experiment/report'
import { STRESS_SCENARIO } from './stress-experiment/scenario'

/**
 * `pnpm stress:render [--check]`: the T26 agentic stress-test harness (ADR-0039). It computes the five
 * instrumented metrics over the PREPARED scenario (`scripts/stress-experiment/`) and:
 *
 *   pnpm stress:render          write docs/stress-experiment.md (the derived report) + the sidecar
 *                               evidence (test-results/stress-experiment.json, gitignored).
 *   pnpm stress:render --check  drift gate: the committed doc must be byte-identical to a fresh render
 *                               (recomputed from the committed scenario, not the gitignored sidecar),
 *                               so an out-of-band edit reds. Wired into `pnpm verify` via stress:verify.
 *
 * SLIM scope, stated plainly: this PREPARES the 100-feature run, it does not execute it. The harness
 * owns no test logic — it derives metrics from the real T23/T24 sources and renders them.
 */

const ROOT = process.cwd()
const DOC = resolve(ROOT, 'docs/stress-experiment.md')
const SIDECAR = resolve(ROOT, 'test-results/stress-experiment.json')

function main(): void {
  const metrics = computeMetrics(STRESS_SCENARIO)
  const doc = renderStressReport(metrics)

  if (process.argv.includes('--check')) {
    assertNoDrift([{ path: DOC, rendered: doc }], '`pnpm stress:render` and commit')
    return
  }

  // Build tooling, not service runtime: a wall-clock stamp is fine here (see anchored-coverage.ts).
  mkdirSync(resolve(ROOT, 'test-results'), { recursive: true })
  writeFileSync(SIDECAR, renderSidecar(metrics, new Date().toISOString()))
  writeFileSync(DOC, doc)
  process.stdout.write(
    `wrote docs/stress-experiment.md + ${SIDECAR}\n` +
      `  cheat-rate ${(metrics.cheatRate.rate * 100).toFixed(1)}% (${metrics.cheatRate.detected}/${metrics.cheatRate.cheated} caught) · ` +
      `false-green ${(metrics.falseGreen.rate * 100).toFixed(1)}% · ` +
      `culprits ${metrics.culprits.length} · ` +
      `human-intervention ${(metrics.humanIntervention.rate * 100).toFixed(1)}% · ` +
      `anchored-drift ${metrics.anchoredDrift.drift}\n`,
  )
}

main()
