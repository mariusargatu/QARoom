import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The coverage floor gate. The x-ray found coverage was measured ad-hoc and never enforced
 * (`coverage:results` folds `passed=1`, no threshold), so a regression — or a brand-new untested
 * module — was invisible. This runs LINE coverage for every gated package against a committed floor
 * and FAILS if any package drops below it. Floors lock the current level so coverage cannot drift
 * down; ratchet them UP as coverage improves, never down to make a red go green.
 *
 *   pnpm coverage            # run coverage for every package, then gate against the floors
 *   pnpm coverage --measure  # run + print %s, do NOT gate (use to recalibrate floors)
 *   pnpm coverage --check    # gate against EXISTING coverage summaries (no re-run; for CI after the lanes)
 *
 * NOT in the fast `pnpm verify` (instrumentation is heavy); wired into the nightly CI tier and run
 * on demand. `services/web` is DEFERRED (its own effort) and deliberately absent — re-add it with a
 * real floor when the frontend suite lands.
 *
 * Measurement is UNIFORM across packages (one include/exclude set here), independent of each
 * package's own vitest config, so the gate is self-contained and every floor is comparable. The
 * exclude set drops tests and the untestable composition roots (server/telemetry bootstrap, the
 * generated OpenAPI/AsyncAPI doc builders).
 */
const ROOT = process.cwd()
const measureOnly = process.argv.includes('--measure')
const checkOnly = process.argv.includes('--check')

interface Target {
  name: string
  dir: string
  kind: 'vitest' | 'pytest'
  /** Minimum line coverage %; the build fails below it. */
  floor: number
}

// Per-package LINE-coverage floors. Calibrated 2026-06 a few points below measured to absorb v8
// run-to-run variance. RATCHET UP as suites grow; never lower to pass.
const TARGETS: Target[] = [
  { name: 'content', dir: 'services/content', kind: 'vitest', floor: 95 },
  { name: 'gateway', dir: 'services/gateway', kind: 'vitest', floor: 94 },
  { name: 'identity', dir: 'services/identity', kind: 'vitest', floor: 96 },
  { name: 'flags', dir: 'services/flags', kind: 'vitest', floor: 92 },
  { name: 'donations', dir: 'services/donations', kind: 'vitest', floor: 88 },
  { name: 'webhooks', dir: 'services/webhooks', kind: 'vitest', floor: 92 },
  // qaroom-mcp / otel / testing-utils / moderator are intentionally left at their original floors
  // (not part of the coverage-raise effort); ratchet them later in their own pass.
  { name: 'qaroom-mcp', dir: 'services/qaroom-mcp', kind: 'vitest', floor: 82 },
  { name: 'contracts', dir: 'packages/contracts', kind: 'vitest', floor: 98 },
  // messaging is honestly infra-capped (~68%): the rest needs a live NATS broker / real Postgres
  // (see the coverage report), so its floor stays modest by design, not neglect.
  { name: 'messaging', dir: 'packages/messaging', kind: 'vitest', floor: 66 },
  { name: 'otel', dir: 'packages/otel', kind: 'vitest', floor: 63 },
  { name: 'service-kit', dir: 'packages/service-kit', kind: 'vitest', floor: 99 },
  { name: 'determinism', dir: 'packages/determinism', kind: 'vitest', floor: 99 },
  { name: 'testing-utils', dir: 'packages/testing-utils', kind: 'vitest', floor: 58 },
  { name: 'moderator-agent', dir: 'services/moderator-agent', kind: 'pytest', floor: 74 },
]

const VITEST_FLAGS = [
  '--coverage.enabled=true',
  '--coverage.provider=v8',
  '--coverage.reporter=json-summary',
  '--coverage.include=src/**/*.{ts,tsx}',
  '--coverage.exclude=**/*.test.*',
  '--coverage.exclude=**/*.spec.*',
  '--coverage.exclude=**/*.probe.*',
  '--coverage.exclude=**/*.ct.*',
  '--coverage.exclude=**/*.stories.*',
  '--coverage.exclude=**/*-fake.ts',
  '--coverage.exclude=**/*.testkit.ts',
  '--coverage.exclude=**/server.ts',
  '--coverage.exclude=**/telemetry.ts',
  '--coverage.exclude=**/openapi-build.ts',
  '--coverage.exclude=**/asyncapi-build.ts',
  '--coverage.exclude=**/openapi-document.ts',
  '--coverage.exclude=**/asyncapi-document.ts',
]

function runVitest(dir: string): void {
  execFileSync('pnpm', ['exec', 'vitest', 'run', ...VITEST_FLAGS], {
    cwd: resolve(ROOT, dir),
    stdio: 'ignore',
    // Opt the gate into the Docker-gated integration specs (e.g. messaging's pgSnapshotStore against
    // real Postgres). They skip cleanly if Docker is absent, so the gate still runs everywhere; where
    // Docker is present they lift coverage of the postgres-js seams PGlite cannot host.
    env: { ...process.env, QAROOM_PG_TESTS: '1' },
  })
}

function runPytest(dir: string): void {
  execFileSync('uv', ['run', 'pytest', '-q', '--cov', '--cov-report=json'], {
    cwd: resolve(ROOT, dir),
    stdio: 'ignore',
  })
}

/** Read line% from a target's coverage report (v8 json-summary or pytest-cov json). */
function readLinePct(t: Target): number | null {
  if (t.kind === 'vitest') {
    const p = resolve(ROOT, t.dir, 'coverage/coverage-summary.json')
    if (!existsSync(p)) return null
    const total = (JSON.parse(readFileSync(p, 'utf8')) as { total?: { lines?: { pct?: number } } })
      .total
    return total?.lines?.pct ?? null
  }
  const p = resolve(ROOT, t.dir, 'coverage.json')
  if (!existsSync(p)) return null
  const totals = (JSON.parse(readFileSync(p, 'utf8')) as { totals?: { percent_covered?: number } })
    .totals
  return totals?.percent_covered === undefined
    ? null
    : Math.round(totals.percent_covered * 100) / 100
}

// `uv` powers the one pytest target. Where it is absent (the CI TS coverage job, a uv-less dev box)
// skip it gracefully rather than fail — moderator coverage is gated in its own lane via
// `pytest --cov-fail-under`. Locally with uv present, the full picture is gated here.
const hasUv = (() => {
  try {
    execFileSync('uv', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const rows: { name: string; pct: number | null; floor: number; ok: boolean; skipped: boolean }[] =
  []
for (const t of TARGETS) {
  if (t.kind === 'pytest' && !hasUv) {
    process.stdout.write(`coverage: skipping ${t.name} (uv not found — gated in its own lane)\n`)
    rows.push({ name: t.name, pct: null, floor: t.floor, ok: true, skipped: true })
    continue
  }
  if (!checkOnly) {
    process.stdout.write(`coverage: running ${t.name} (${t.kind})\n`)
    try {
      t.kind === 'vitest' ? runVitest(t.dir) : runPytest(t.dir)
    } catch {
      // A failing suite still wrote a partial summary in most cases; if not, readLinePct returns
      // null and the row fails. Do not abort the sweep — report every package.
      process.stderr.write(`  ${t.name}: suite run exited non-zero (see its own lane)\n`)
    }
  }
  const pct = readLinePct(t)
  const ok = !measureOnly && pct !== null && pct >= t.floor
  rows.push({ name: t.name, pct, floor: t.floor, ok, skipped: false })
}

const w = Math.max(...TARGETS.map((t) => t.name.length))
process.stdout.write('\nLine coverage vs floor (web deferred):\n')
for (const r of rows) {
  const pctStr = r.skipped ? 'skipped' : r.pct === null ? 'NO REPORT' : `${r.pct}%`
  const mark = measureOnly ? '·' : r.skipped ? '–' : r.pct !== null && r.pct >= r.floor ? '✓' : '✗'
  process.stdout.write(`  ${mark} ${r.name.padEnd(w)}  ${pctStr.padStart(10)}  floor ${r.floor}%\n`)
}

if (measureOnly) {
  process.stdout.write('\n(measure mode — no gate)\n')
  process.exit(0)
}

const below = rows.filter((r) => !r.skipped && (r.pct === null || r.pct < r.floor))
if (below.length > 0) {
  process.stderr.write(
    `\ncoverage gate FAILED: ${below.length} package(s) below floor — ${below
      .map((r) => `${r.name} ${r.pct === null ? 'no-report' : `${r.pct}<${r.floor}`}`)
      .join(', ')}\n`,
  )
  process.exit(1)
}
process.stdout.write(`\ncoverage gate ✓: all ${rows.length} packages meet their floor\n`)
