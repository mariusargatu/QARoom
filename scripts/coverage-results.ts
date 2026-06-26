import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { foldRunner } from './lib/fold-runner'

/**
 * Fold per-service coverage into the frozen test-results/summary.json envelope as `coverage:<svc>`
 * runners (plus the web `coverage` runner). Each backend service emits a v8 `coverage-summary.json`
 * (the json-summary reporter in the shared defineServiceConfig); web emits a single V8 summary from
 * the Storybook/Vitest browser run (ADR-0027 — no more V8+Istanbul merge). Informational, not a gate:
 * every coverage runner folds as passed. Tolerant — a service whose coverage lane has not run is
 * skipped with a warning, so this works after a partial run.
 *
 * Run after the per-service `test:coverage` lanes (and, for web, `test:stories:coverage`).
 * See UNIT-L1-PLAN.md §4.
 */
const ROOT = process.cwd()
const summaryPath = resolve(ROOT, 'test-results/summary.json')

interface Metric {
  total?: number
  covered?: number
  pct?: number
}

interface Scope {
  /** Unique runner name in summary.json. */
  runner: string
  /** Directory holding coverage-summary.json, relative to the repo root. */
  dir: string
  /** Human scope label for output.scope. */
  scope: string
  /** Tool label for output.runner. */
  tool: string
}

// Backend services on the shared v8 config + the existing merged web lane.
const SCOPES: Scope[] = [
  {
    runner: 'coverage:content',
    dir: 'services/content/coverage',
    scope: 'services/content',
    tool: 'v8',
  },
  {
    runner: 'coverage:donations',
    dir: 'services/donations/coverage',
    scope: 'services/donations',
    tool: 'v8',
  },
  { runner: 'coverage:flags', dir: 'services/flags/coverage', scope: 'services/flags', tool: 'v8' },
  {
    runner: 'coverage:gateway',
    dir: 'services/gateway/coverage',
    scope: 'services/gateway',
    tool: 'v8',
  },
  {
    runner: 'coverage:identity',
    dir: 'services/identity/coverage',
    scope: 'services/identity',
    tool: 'v8',
  },
  {
    // ADR-0027: V8 only (no V8+Istanbul merge). Two web browser runs each fold a V8 runner — the
    // Storybook stories run (covers what `play()` exercises) ...
    runner: 'coverage',
    dir: 'services/web/coverage',
    scope: 'services/web',
    tool: 'v8',
  },
  {
    // ... the Screenplay component run (covers what only the `*.browser.test.tsx` tests exercise,
    // which the stories run does not — restored after the Istanbul-merge tier was removed) ...
    runner: 'coverage:web-component',
    dir: 'services/web/coverage-component',
    scope: 'services/web',
    tool: 'v8',
  },
  {
    // ... and the node unit run (api/client, http, lib, session/jwt, flow machines — browser-free
    // code the two browser runs never import).
    runner: 'coverage:web-node',
    dir: 'services/web/coverage-node',
    scope: 'services/web',
    tool: 'v8',
  },
]

const pick = (summary: Record<string, Metric>, key: string): Metric => summary[key] ?? {}

let folded = 0
const report: string[] = []
for (const s of SCOPES) {
  const reportPath = resolve(ROOT, s.dir, 'coverage-summary.json')
  if (!existsSync(reportPath)) {
    process.stderr.write(`skip ${s.runner}: no coverage-summary.json at ${s.dir}\n`)
    continue
  }
  let parsed: { total?: Record<string, Metric> }
  try {
    parsed = JSON.parse(readFileSync(reportPath, 'utf8')) as { total?: Record<string, Metric> }
  } catch (err) {
    // A truncated/corrupt report (e.g. a lane killed mid-write) skips this scope, not the whole fold.
    process.stderr.write(`skip ${s.runner}: ${reportPath} is not valid JSON (${String(err)})\n`)
    continue
  }
  const total = parsed.total ?? {}
  const metrics = {
    lines: pick(total, 'lines'),
    branches: pick(total, 'branches'),
    functions: pick(total, 'functions'),
    statements: pick(total, 'statements'),
  }
  if (metrics.lines.pct === undefined) {
    process.stderr.write(`skip ${s.runner}: no lines.pct in ${reportPath} (format drift?)\n`)
    continue
  }
  foldRunner(summaryPath, {
    name: s.runner,
    passed: 1,
    failed: 0,
    skipped: 0,
    duration_ms: 0,
    output: {
      runner: s.tool,
      scope: s.scope,
      source: reportPath.slice(ROOT.length + 1),
      ...metrics,
    },
    seeds: {},
  })
  folded += 1
  report.push(
    `  ${s.runner}: lines ${metrics.lines.pct}%, branches ${metrics.branches.pct ?? '?'}%`,
  )
}

// Drift guard: warn loudly if a service declares a `test:coverage` script but is absent from SCOPES
// (e.g. flags/gateway/identity adopt coverage in a later PR and the SCOPES edit is forgotten — their
// coverage would silently never fold). Cheap to keep the explicit SCOPES list honest.
const coveredDirs = new Set(SCOPES.map((s) => s.dir))
for (const svc of readdirSync(resolve(ROOT, 'services'))) {
  const pkgPath = resolve(ROOT, 'services', svc, 'package.json')
  if (!existsSync(pkgPath)) continue
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> }
  if (pkg.scripts?.['test:coverage'] && !coveredDirs.has(`services/${svc}/coverage`)) {
    process.stderr.write(
      `warning: services/${svc} declares a test:coverage script but has no SCOPES entry — its coverage will never fold\n`,
    )
  }
}

if (folded === 0) {
  process.stderr.write('no coverage reports found — run the per-service coverage lanes first\n')
  process.exit(2)
}
process.stdout.write(
  `folded ${folded} coverage runner(s) into summary.json\n${report.join('\n')}\n`,
)
