import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TestResultsSummary } from '@qaroom/contracts'
import { RUNNERS, type RunnerTier, runnerNames } from './lib/runners'

/**
 * `pnpm test-results:verify`: validate `test-results/summary.json` against the frozen schema
 * (Commitment 14) AND run a CENSUS over it (roadmap T3 / C3). Schema-validation answers "is the shape
 * right"; the census answers "did the runners that were supposed to run actually run".
 *
 * The roster is the single DECLARED registry in scripts/lib/runners.ts (one row per runner). The
 * census checks that registry against the runners actually present in summary.json — an artifact
 * produced independently of the registry — so the gate is empirical, not a re-statement of itself:
 *   - UNDECLARED (every lane): a runner folded into summary.json with no registry row is a typo or an
 *     un-tracked fold → RED. This is strictly STRONGER than the old "a `name:` literal exists in a
 *     *-results.ts source file": it proves the fold ACTUALLY RAN, and it sees the coverage:<backend>
 *     family the old source-scraping regex could not (they fold under a dynamic `name`).
 *   - MISSING (full tier): every non-optional row must be present, so a silently-absent runner (k6
 *     didn't run, chaos didn't run) turns the gate RED instead of shipping a green-but-partial summary.
 *
 * (This replaced a two-witness pair — a regex that scraped the `name:` literal out of *-results.ts
 * SOURCE, cross-checked against a hand-kept tier map. The regex's `(?!spec:)` lookahead had forced a
 * fold script to rename a field `spec`→`specPath` purely to dodge the scraper: the measure distorting
 * the measured. The declared registry + summary.json witness removes both the regex and that rename.)
 *
 * Two tiers, because the runners split by where they run:
 *   - in-proc (default): the cheap vitest/MBT/Playwright job. A light run MUST NOT fail just because
 *     the cluster/keyed runners are absent — they legitimately did not run. Only the vitest aggregate
 *     is hard-required (an empty summary.json is still caught).
 *   - full (`--tier full` | `--tier=full` | QAROOM_VERIFY_TIER=full): the nightly/cluster job. Every
 *     in-proc AND cluster runner MUST be present.
 */

const ROOT = process.cwd()
const SUMMARY_PATH = resolve(ROOT, 'test-results/summary.json')

type Tier = 'in-proc' | 'full'

function resolveTier(): Tier {
  const flagIdx = process.argv.indexOf('--tier')
  const fromFlag = flagIdx !== -1 ? process.argv[flagIdx + 1] : undefined
  const fromEq = process.argv.find((a) => a.startsWith('--tier='))?.split('=')[1]
  const raw = (fromFlag ?? fromEq ?? process.env.QAROOM_VERIFY_TIER ?? 'in-proc').toLowerCase()
  return raw === 'full' ? 'full' : 'in-proc'
}

function namesForTier(t: RunnerTier): string[] {
  return RUNNERS.filter((r) => r.tier === t)
    .map((r) => r.name)
    .sort()
}

function vitestAggregatePresent(summary: TestResultsSummary): boolean {
  return summary.runners.some((r) => r.output.runner === 'vitest')
}

/**
 * Runners that folded into summary.json but have no row in scripts/lib/runners.ts — a typo or an
 * un-tracked fold. The vitest aggregate (one runner per workspace package, matched structurally by
 * `output.runner === 'vitest'`) is exempt: it is not a registry subject.
 */
function undeclaredRunners(summary: TestResultsSummary): string[] {
  const declared = runnerNames()
  return summary.runners
    .filter((r) => r.output.runner !== 'vitest' && !declared.has(r.name))
    .map((r) => r.name)
    .sort()
}

/** Run the census; return the number of FATAL findings (0 = pass). All output is to stdout/stderr. */
export function runCensus(summary: TestResultsSummary, tier: Tier): number {
  const present = new Set(summary.runners.map((r) => r.name))
  const vitestRunners = summary.runners.filter((r) => r.output.runner === 'vitest').length

  process.stdout.write(
    `test-results census — tier=${tier}, schema_version=${summary.schema_version}, ` +
      `${summary.runners.length} runners, ${summary.totals.passed} passed / ${summary.totals.failed} failed\n`,
  )
  process.stdout.write(
    `  roster: ${RUNNERS.length} declared runners (scripts/lib/runners.ts) + the vitest aggregate\n`,
  )

  const fatal: string[] = []

  // UNDECLARED: a folded runner with no registry row (replaces the source-scraping rosterDrift, and
  // is stronger — it proves the fold ran, and sees dynamically-named runners the regex could not).
  for (const name of undeclaredRunners(summary)) {
    fatal.push(
      `runner '${name}' folded into summary.json but is not declared in scripts/lib/runners.ts — add a RUNNERS row`,
    )
  }

  // A recorded failure is never "census clean": a summary carrying totals.failed>0 (a crashed lane
  // folded into the envelope, or a hand-edit) must turn the gate RED, not validate green.
  if (summary.totals.failed > 0) {
    fatal.push(`summary records ${summary.totals.failed} failed test(s) — not census-clean`)
  }

  // The vitest aggregate is the one hard requirement of EVERY tier (catches an empty summary.json).
  if (vitestAggregatePresent(summary)) {
    process.stdout.write(`  ✓ vitest-aggregate: present (${vitestRunners} package runners)\n`)
  } else {
    fatal.push('vitest aggregate absent — run `pnpm test-results:generate`')
    process.stdout.write('  ✗ vitest-aggregate: ABSENT\n')
  }

  const inProc = namesForTier('in-proc')
  const cluster = namesForTier('cluster')
  const optional = namesForTier('optional')

  const missingInProc = inProc.filter((n) => !present.has(n))
  const missingCluster = cluster.filter((n) => !present.has(n))

  if (tier === 'full') {
    // Full tier: in-proc AND cluster runners must all be present.
    const required = [...inProc, ...cluster].sort()
    const presentReq = required.filter((n) => present.has(n))
    process.stdout.write(`  in-proc+cluster: ${presentReq.length}/${required.length} present\n`)
    const missing = [...missingInProc, ...missingCluster].sort()
    if (missing.length > 0) {
      fatal.push(`full-tier run is missing required runner(s): ${missing.join(', ')}`)
      process.stdout.write(`  ✗ missing under --tier full: ${missing.join(', ')}\n`)
    }
  } else {
    // Light tier: never fail on a missing in-proc/cluster runner; report cluster ones as DEFERRED.
    const inProcPresent = inProc.filter((n) => present.has(n))
    process.stdout.write(
      `  in-proc:  ${inProcPresent.length}/${inProc.length} present` +
        (missingInProc.length > 0 ? ` (absent in this lane: ${missingInProc.join(', ')})` : '') +
        '\n',
    )
    process.stdout.write(
      `  cluster:  ${missingCluster.length} deferred (expected only under --tier full): ` +
        `${missingCluster.join(', ') || 'none'}\n`,
    )
  }

  const optionalPresent = optional.filter((n) => present.has(n))
  process.stdout.write(
    `  optional: ${optionalPresent.length}/${optional.length} present` +
      (optionalPresent.length > 0 ? ` (${optionalPresent.join(', ')})` : '') +
      ' (never required)\n',
  )

  for (const problem of fatal) process.stderr.write(`  drift: ${problem}\n`)
  return fatal.length
}

function main(): void {
  const summary = TestResultsSummary.parse(JSON.parse(readFileSync(SUMMARY_PATH, 'utf8')))
  const tier = resolveTier()
  const fatal = runCensus(summary, tier)

  if (fatal > 0) {
    process.stderr.write(
      `\ntest-results:verify FAILED: ${fatal} census finding(s) at tier=${tier}\n`,
    )
    process.exit(1)
  }
  process.stdout.write(`\ntest-results:verify ✓ — schema valid and census clean at tier=${tier}\n`)
}

// Only run the CLI when invoked directly; claims-verify.ts imports the registry, not this module's main.
function invokedDirectly(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (invokedDirectly()) main()
