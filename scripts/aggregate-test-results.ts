import { execFileSync } from 'node:child_process'
import { existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { TestResultsSummary } from '@qaroom/contracts'
import { foldVitestReport } from './lib/fold-runner'

/**
 * Runs every workspace package's test suite (emitting Vitest JSON), then merges
 * the results into the frozen `test-results/summary.json` envelope (Commitment
 * 14). The fast-check seed is recorded so a property failure is replayable
 * (`VITEST_SEED=<seed> pnpm test`). Exits non-zero if any suite failed.
 *
 * This script REWRITES the envelope from scratch (a fresh, commit-stamped base; runners []), then
 * folds each package's Vitest report into it via the shared `foldVitestReport` (single home for the
 * read+parse+map+false-green block). The other `*-results.ts` scripts fold their runners in afterward.
 */
const ROOT = process.cwd()

function activeSeed(): number {
  const env = process.env.VITEST_SEED
  return env !== undefined && env !== '' ? Number(env) : 0xc0ffee
}

function currentCommit(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}

const seed = activeSeed()
const outDir = resolve(ROOT, 'test-results')
const summaryPath = resolve(outDir, 'summary.json')

// Stamp a fresh base envelope (commit + generated_at) before folding. `foldRunner` preserves both
// across folds via `...base`, so they survive into the final summary while runners accumulate.
mkdirSync(outDir, { recursive: true })
const base = TestResultsSummary.parse({
  schema_version: 1,
  generated_at: new Date().toISOString(),
  commit: currentCommit(),
  totals: { passed: 0, failed: 0, skipped: 0 },
  runners: [],
})
writeFileSync(summaryPath, `${JSON.stringify(base, null, 2)}\n`)

let anySuiteFailed = false
let foldedRunners = 0
let totals = { passed: 0, failed: 0, skipped: 0 }

const packageJsonPaths = globSync('{packages,services,tools}/*/package.json', { cwd: ROOT }).sort()

for (const rel of packageJsonPaths) {
  const dir = resolve(ROOT, dirname(rel))
  const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'))
  if (!pkg.scripts || typeof pkg.scripts.test !== 'string') continue
  // Only vitest suites belong to this sweep. The moderator-agent's `test` script is pytest
  // (ADR-0018 turbo passthrough); spawning vitest in that Python package finds zero test files,
  // writes an empty success:false report, and false-reds the whole aggregate while the printed
  // totals still say "0 failed". Its suite is folded separately by scripts/moderator-results.ts.
  if (!pkg.scripts.test.includes('vitest')) continue

  const outRel = 'test-results/vitest.json'
  try {
    execFileSync('pnpm', ['exec', 'vitest', 'run', '--reporter=json', `--outputFile=${outRel}`], {
      cwd: dir,
      stdio: 'inherit',
    })
  } catch {
    anySuiteFailed = true
  }

  const outPath = resolve(dir, outRel)
  if (!existsSync(outPath)) continue

  const result = foldVitestReport(summaryPath, {
    name: pkg.name ?? basename(dir),
    reportPath: outPath,
    runnerLabel: 'vitest',
    seeds: { fastcheck: seed },
  })
  totals = result.totals
  foldedRunners += 1
}

process.stdout.write(
  `wrote test-results/summary.json — ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped across ${foldedRunners} runners\n`,
)
process.exit(anySuiteFailed || totals.failed > 0 ? 1 : 0)
