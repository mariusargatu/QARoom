import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Two gates (Commitment 3):
 *   1. Drift — regenerate each service's openapi.yaml from Zod and fail if the
 *      committed file differs (the round-trip must hold).
 *   2. Breaking changes — run oasdiff (via Docker) and prove it both passes for
 *      identical specs AND fails for a deliberately breaking change (exit crit 3).
 */
const ROOT = process.cwd()
const DRIFT_SERVICES = ['content', 'identity', 'gateway', 'flags', 'donations'] as const

/** Regenerate one service's OpenAPI and fail if the committed file is stale. */
function checkDrift(svc: string): void {
  const specPath = resolve(ROOT, `services/${svc}/openapi.yaml`)
  const before = readFileSync(specPath, 'utf8')
  execFileSync('pnpm', ['--filter', `@qaroom/${svc}`, 'openapi:generate'], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  const after = readFileSync(specPath, 'utf8')
  if (before !== after) {
    process.stderr.write(
      `OpenAPI drift: committed services/${svc}/openapi.yaml was stale. It has been regenerated — commit the result.\n`,
    )
    process.exit(1)
  }
  process.stdout.write(`openapi drift gate (${svc}): committed spec matches Zod ✓\n`)
}

for (const svc of DRIFT_SERVICES) checkDrift(svc)

function hasDocker(): boolean {
  try {
    execFileSync('docker', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

if (!hasDocker()) {
  process.stdout.write('docker unavailable — skipping oasdiff breaking-change gate\n')
  process.exit(0)
}

const fixturesDir = resolve(ROOT, 'services/content/tests/fixtures/oasdiff')

// Fixed oasdiff invocation; only the spec pair varies per call.
const OASDIFF_DOCKER_ARGS = [
  'run',
  '--rm',
  '-v',
  `${fixturesDir}:/specs:ro`,
  'tufin/oasdiff',
  'breaking',
] as const

function oasdiffExitCode(base: string, revision: string): number {
  try {
    execFileSync(
      'docker',
      [...OASDIFF_DOCKER_ARGS, `/specs/${base}`, `/specs/${revision}`, '--fail-on', 'ERR'],
      { stdio: 'inherit' },
    )
    return 0
  } catch (error) {
    return (error as { status?: number }).status ?? 1
  }
}

if (oasdiffExitCode('base.yaml', 'base.yaml') !== 0) {
  process.stderr.write('oasdiff flagged identical specs as breaking — gate is misconfigured.\n')
  process.exit(1)
}
if (oasdiffExitCode('base.yaml', 'breaking.yaml') === 0) {
  process.stderr.write('oasdiff did NOT detect the deliberate breaking change — gate is broken.\n')
  process.exit(1)
}
process.stdout.write(
  'oasdiff gate: identical specs pass, deliberate breaking change detected ✓ (exit criterion 3)\n',
)
