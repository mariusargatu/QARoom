import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { asyncapiBreakingChanges } from '@qaroom/testing-utils/async-diff'
import { parse } from 'yaml'

/**
 * Two gates (ADR-0002, the async mirror of `openapi-verify.ts`):
 *   1. Drift — regenerate each service's `asyncapi.yaml` from Zod and fail if the committed
 *      file differs (the round-trip must hold).
 *   2. Breaking changes — run the QARoom classifier (`@asyncapi/diff` as detector + the
 *      direction-aware rule table) and prove it both PASSES for identical specs AND FAILS
 *      for a deliberately breaking fixture (exit criterion: a breaking AsyncAPI change is
 *      caught before merge).
 */
const ROOT = process.cwd()
const DRIFT_SERVICES = ['content', 'flags', 'donations', 'gateway'] as const

function checkDrift(svc: string): void {
  const specPath = resolve(ROOT, `services/${svc}/asyncapi.yaml`)
  const before = readFileSync(specPath, 'utf8')
  execFileSync('pnpm', ['--filter', `@qaroom/${svc}`, 'asyncapi:generate'], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  const after = readFileSync(specPath, 'utf8')
  if (before !== after) {
    process.stderr.write(
      `AsyncAPI drift: committed services/${svc}/asyncapi.yaml was stale. It has been regenerated — commit the result.\n`,
    )
    process.exit(1)
  }
  process.stdout.write(`asyncapi drift gate (${svc}): committed spec matches Zod ✓\n`)
}

for (const svc of DRIFT_SERVICES) checkDrift(svc)

// Breaking-change gate: prove identical specs pass and the deliberate breaking fixture fails.
const fixtures = resolve(ROOT, 'services/content/tests/fixtures/asyncapi')
const base = parse(readFileSync(resolve(fixtures, 'base.yaml'), 'utf8')) as Record<string, unknown>
const breaking = parse(readFileSync(resolve(fixtures, 'breaking.yaml'), 'utf8')) as Record<
  string,
  unknown
>

if (asyncapiBreakingChanges(base, base).length !== 0) {
  process.stderr.write(
    'asyncapi classifier flagged identical specs as breaking — gate is misconfigured.\n',
  )
  process.exit(1)
}
const found = asyncapiBreakingChanges(base, breaking)
if (found.length === 0) {
  process.stderr.write(
    'asyncapi classifier did NOT detect the deliberate breaking change — gate is broken.\n',
  )
  process.exit(1)
}
process.stdout.write(
  `asyncapi breaking-change gate: identical specs pass, ${found.length} breaking change(s) detected in the fixture ✓\n`,
)
