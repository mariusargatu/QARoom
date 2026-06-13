import { globSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TestResultsSummary } from '@qaroom/contracts'

/**
 * `pnpm test-results:verify`: validate `test-results/summary.json` against the frozen schema
 * (Commitment 14) AND run a CENSUS over it (roadmap T3 / C3). Schema-validation answers "is the
 * shape right"; the census answers "did the runners that were supposed to run actually run". The
 * roster is DERIVED from the *-results.ts scripts themselves (see deriveFoldedRunnerNames), so it
 * cannot rot the way a hand-kept list does.
 *
 * Two tiers, because the runners split by where they run:
 *   - in-proc (default): the cheap vitest/MBT/Playwright job. A light run MUST NOT fail just because
 *     the cluster/keyed runners are absent — they legitimately did not run. Only the vitest
 *     aggregate is hard-required (an empty summary.json is still caught).
 *   - full (`--tier full` | `--tier=full` | QAROOM_VERIFY_TIER=full): the nightly/cluster job. Every
 *     in-proc AND cluster runner MUST be present, so a silently-missing runner (k6 didn't run, chaos
 *     didn't run) turns the gate RED instead of shipping a green-but-partial summary.
 */

const ROOT = process.cwd()
const SUMMARY_PATH = resolve(ROOT, 'test-results/summary.json')

export type RunnerTier = 'in-proc' | 'cluster' | 'optional'

// The NAMES come from the result scripts (deriveFoldedRunnerNames); this map only assigns each a
// tier. A folded runner missing from this map fails the drift check below (forcing a human to
// classify it), and a name here that no script folds is also flagged — that bidirectional gate is
// what makes the census real rather than decorative.
//   in-proc  — runs in CI's cheap in-process job; hard-required under --tier full.
//   cluster  — needs a live cluster or a model key; expected only under --tier full (else DEFERRED).
//   optional — folded by a script but gated on a heavyweight toolchain (Java/Python/Pact broker);
//              recognised so the drift check passes, never required by any tier.
const RUNNER_TIERS: Record<string, RunnerTier> = {
  'mbt-edge-coverage': 'in-proc',
  'web-ct': 'in-proc',
  'web-e2e': 'in-proc',
  k6: 'cluster',
  chaos: 'cluster',
  tracetest: 'cluster',
  journey: 'cluster',
  'tenant-spans': 'cluster',
  deepeval: 'cluster',
  deepteam: 'cluster',
  pyrit: 'cluster',
  'golden-sme': 'cluster',
  coverage: 'optional',
  evomaster: 'optional',
  moderator: 'optional',
  pact: 'optional',
  schemathesis: 'optional',
  stryker: 'optional',
}

// Classified names that are NOT folded by a *-results.ts (so deriveFoldedRunnerNames can't see them):
// tenant-spans is folded by scripts/check-tenant-spans.ts via its `--fold` side-channel. Exempt it
// from the "every classified name is folded by a script" direction of the drift check.
const RUNNERS_WITHOUT_RESULTS_SCRIPT = new Set(['tenant-spans'])

/**
 * Derive the runner names the repo's `*-results.ts` scripts actually fold into summary.json — the
 * authoritative roster the census (and claims:verify's valid-runner set) build on. Extracts the
 * `name:` handed to foldRunner/foldVitestReport and the first argument of foldEvalRunner. Schemathesis'
 * per-spec targets (`{ name, spec }`) are excluded by the `spec:` lookahead; aggregate-test-results.ts
 * is excluded because it folds one runner per workspace package (matched structurally as the vitest
 * aggregate), not a fixed name.
 */
export function deriveFoldedRunnerNames(root = ROOT): Set<string> {
  const files = [
    ...globSync('scripts/*-results.ts', { cwd: root }),
    ...globSync('services/web/scripts/*-results.ts', { cwd: root }),
  ]
    .filter((rel) => !rel.endsWith('aggregate-test-results.ts'))
    .sort()
  const names = new Set<string>()
  for (const rel of files) {
    const src = readFileSync(resolve(root, rel), 'utf8')
    for (const m of src.matchAll(/name:\s*'([^']+)'\s*,(?!\s*spec:)/g)) {
      if (m[1] !== undefined) names.add(m[1])
    }
    for (const m of src.matchAll(/foldEvalRunner\(\s*'([^']+)'/g)) {
      if (m[1] !== undefined) names.add(m[1])
    }
  }
  return names
}

type Tier = 'in-proc' | 'full'

function resolveTier(): Tier {
  const flagIdx = process.argv.indexOf('--tier')
  const fromFlag = flagIdx !== -1 ? process.argv[flagIdx + 1] : undefined
  const fromEq = process.argv.find((a) => a.startsWith('--tier='))?.split('=')[1]
  const raw = (fromFlag ?? fromEq ?? process.env.QAROOM_VERIFY_TIER ?? 'in-proc').toLowerCase()
  return raw === 'full' ? 'full' : 'in-proc'
}

function namesForTier(t: RunnerTier): string[] {
  return Object.keys(RUNNER_TIERS)
    .filter((name) => RUNNER_TIERS[name] === t)
    .sort()
}

// Bidirectional drift gate: the derived roster and the tier map must agree, so neither can rot
// unnoticed (this is the failure mode that left claims-verify carrying a dropped 'promptfoo' runner).
function rosterDrift(folded: Set<string>): string[] {
  const problems: string[] = []
  for (const name of [...folded].sort()) {
    if (!(name in RUNNER_TIERS)) {
      problems.push(
        `runner '${name}' is folded by a *-results.ts script but not classified — give it a tier in RUNNER_TIERS`,
      )
    }
  }
  for (const name of Object.keys(RUNNER_TIERS).sort()) {
    if (!folded.has(name) && !RUNNERS_WITHOUT_RESULTS_SCRIPT.has(name)) {
      problems.push(
        `RUNNER_TIERS lists '${name}' but no *-results.ts folds it — stale roster entry`,
      )
    }
  }
  return problems
}

function vitestAggregatePresent(summary: TestResultsSummary): boolean {
  return summary.runners.some((r) => r.output.runner === 'vitest')
}

/** Run the census; return the number of FATAL findings (0 = pass). All output is to stdout/stderr. */
function runCensus(summary: TestResultsSummary, tier: Tier, folded: Set<string>): number {
  const present = new Set(summary.runners.map((r) => r.name))
  const vitestRunners = summary.runners.filter((r) => r.output.runner === 'vitest').length

  process.stdout.write(
    `test-results census — tier=${tier}, schema_version=${summary.schema_version}, ` +
      `${summary.runners.length} runners, ${summary.totals.passed} passed / ${summary.totals.failed} failed\n`,
  )
  process.stdout.write(
    `  roster: ${folded.size} runners folded by *-results.ts + the vitest aggregate (derived from source)\n`,
  )

  const fatal: string[] = [...rosterDrift(folded)]

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
  const folded = deriveFoldedRunnerNames()
  const fatal = runCensus(summary, tier, folded)

  if (fatal > 0) {
    process.stderr.write(
      `\ntest-results:verify FAILED: ${fatal} census finding(s) at tier=${tier}\n`,
    )
    process.exit(1)
  }
  process.stdout.write(`\ntest-results:verify ✓ — schema valid and census clean at tier=${tier}\n`)
}

// Only run the CLI when invoked directly; claims-verify.ts imports deriveFoldedRunnerNames from here.
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
