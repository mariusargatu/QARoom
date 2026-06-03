import { execFileSync } from 'node:child_process'
import { existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { TestResultsSummary } from '@qaroom/contracts'

/**
 * Runs every workspace package's test suite (emitting Vitest JSON), then merges
 * the results into the frozen `test-results/summary.json` envelope (Commitment
 * 14). The fast-check seed is recorded so a property failure is replayable
 * (`VITEST_SEED=<seed> pnpm test`). Exits non-zero if any suite failed.
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
const runners = []
let anySuiteFailed = false

const packageJsonPaths = globSync('{packages,services,tools}/*/package.json', { cwd: ROOT }).sort()

for (const rel of packageJsonPaths) {
  const dir = resolve(ROOT, dirname(rel))
  const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'))
  if (!pkg.scripts || typeof pkg.scripts.test !== 'string') continue

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
  const report = JSON.parse(readFileSync(outPath, 'utf8'))
  const fileDuration = (f: { startTime?: number; endTime?: number }) =>
    (f.endTime ?? 0) - (f.startTime ?? 0)
  const duration = (report.testResults ?? []).reduce(
    (sum: number, file: { startTime?: number; endTime?: number }) => sum + fileDuration(file),
    0,
  )

  runners.push({
    name: pkg.name ?? basename(dir),
    passed: report.numPassedTests ?? 0,
    failed: report.numFailedTests ?? 0,
    skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
    duration_ms: Math.round(duration),
    output: { runner: 'vitest', success: report.success === true },
    seeds: { fastcheck: seed },
  })
}

const totals = runners.reduce(
  (acc, runner) => ({
    passed: acc.passed + runner.passed,
    failed: acc.failed + runner.failed,
    skipped: acc.skipped + runner.skipped,
  }),
  { passed: 0, failed: 0, skipped: 0 },
)

const summary = TestResultsSummary.parse({
  schema_version: 1,
  generated_at: new Date().toISOString(),
  commit: currentCommit(),
  totals,
  runners,
})

const outDir = resolve(ROOT, 'test-results')
mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
process.stdout.write(
  `wrote test-results/summary.json — ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped across ${runners.length} runners\n`,
)
process.exit(anySuiteFailed || totals.failed > 0 ? 1 : 0)
