import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { foldRunner } from './lib/fold-runner'

/**
 * Run the Schemathesis gate (scripts/schemathesis-gate.sh) against one or more live targets and
 * fold the outcome into the frozen test-results/summary.json envelope as a `schemathesis` runner.
 * Until now the three fuzz lanes lived only as separate CI jobs, so trust-boundary fuzzing never
 * appeared in the summary (the "evidence fragmentation" gap). Verdicts key on the gate's exit
 * code — the same signal CI gates on — with a best-effort parse of the run banner for evidence.
 *
 *   pnpm schemathesis:results                                  # default targets (services must be up)
 *   pnpm schemathesis:results gateway:services/gateway:http://host.docker.internal:8090
 *   SCHEMATHESIS_MAX_EXAMPLES=100 pnpm schemathesis:results    # nightly/gauntlet budget
 */
const ROOT = process.cwd()
const summaryPath = resolve(ROOT, 'test-results/summary.json')
const maxExamples = process.env.SCHEMATHESIS_MAX_EXAMPLES ?? '12'

interface Target {
  name: string
  spec: string
  url: string
}

// Default targets mirror the CI fuzz/fuzz-identity/fuzz-webhooks jobs (ports from ci.yml).
const DEFAULT_TARGETS: Target[] = [
  { name: 'gateway', spec: 'services/gateway', url: 'http://host.docker.internal:8090' },
  { name: 'identity', spec: 'services/identity', url: 'http://host.docker.internal:8082' },
  { name: 'webhooks', spec: 'services/webhooks', url: 'http://host.docker.internal:8087' },
]

const parseTarget = (arg: string): Target => {
  const [name, spec, ...urlParts] = arg.split(':')
  const url = urlParts.join(':')
  if (!name || !spec || !url) {
    process.stderr.write(`bad target "${arg}" — expected name:specDir:baseUrl\n`)
    process.exit(2)
  }
  return { name, spec, url }
}

const cli = process.argv.slice(2)
const targets = cli.length > 0 ? cli.map(parseTarget) : DEFAULT_TARGETS

const results = targets.map((t) => {
  process.stdout.write(`▶ schemathesis-gate ${t.name} (${t.url}, max-examples=${maxExamples})\n`)
  const started = Date.now()
  const run = spawnSync('bash', ['scripts/schemathesis-gate.sh', t.spec, t.url, maxExamples], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  const duration_ms = Date.now() - started
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`
  // Best-effort evidence from the human banner; absence is tolerated (exit code is the verdict).
  const seed = out.match(/seed[^\d-]*(-?\d+)/i)?.[1] ?? null
  const tail = out
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .slice(-6)
  const passed = run.status === 0
  if (!passed) process.stderr.write(`✗ ${t.name} gate red (exit ${run.status})\n`)
  return { target: t.name, url: t.url, passed, exit: run.status, seed, duration_ms, tail }
})

const failed = results.filter((r) => !r.passed).length
const runner = {
  name: 'schemathesis',
  passed: results.length - failed,
  failed,
  skipped: 0,
  duration_ms: results.reduce((sum, r) => sum + r.duration_ms, 0),
  output: {
    runner: 'schemathesis-gate',
    success: failed === 0,
    max_examples: Number(maxExamples),
    targets: results,
  },
  seeds: Object.fromEntries(
    results.filter((r) => r.seed !== null).map((r) => [r.target, Number(r.seed)]),
  ),
}

foldRunner(summaryPath, runner)
process.stdout.write(
  `merged schemathesis runner into summary.json — ${runner.passed} target(s) passed, ${failed} failed\n`,
)
process.exit(failed === 0 ? 0 : 1)
