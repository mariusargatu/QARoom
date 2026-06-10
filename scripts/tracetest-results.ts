import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { foldRunner } from './lib/fold-runner'

/**
 * Run the Tracetest suite (the same five defs as the CI tracetest job) against a live cluster and
 * fold the outcome into the frozen test-results/summary.json envelope as a `tracetest` runner.
 * Until now the trace-based layer lived only as a CI job, so it never appeared in the summary
 * (the "evidence fragmentation" gap). The invocation is lifted verbatim from ci.yml — verdicts
 * key on the CLI exit code, the signal CI already gates on.
 *
 * Prerequisites: a reachable Tracetest server. With TRACETEST_SERVER_URL set the script runs
 * `tracetest configure` first; otherwise it assumes the CLI is already configured (CI pattern:
 * port-forward svc/qaroom-tracetest 11633 and configure once).
 *
 *   pnpm tracetest:results                                       # all five defs
 *   pnpm tracetest:results services/content/tests/tracetest/feed-read.yaml
 */
const ROOT = process.cwd()
const summaryPath = resolve(ROOT, 'test-results/summary.json')

interface Def {
  file: string
  needsRunId: boolean
}

// The committed suite (mirrors ci.yml). rollout/donation defs take a unique per-run id so their
// Idempotency-Key (`tt-${var:runId}`) does not hit idempotent replay and suppress the transition.
const DEFAULT_DEFS: Def[] = [
  { file: 'services/content/tests/tracetest/post-created-publish.yaml', needsRunId: false },
  { file: 'services/content/tests/tracetest/feed-read.yaml', needsRunId: false },
  {
    file: 'services/content/tests/tracetest/create-missing-idempotency-key.yaml',
    needsRunId: false,
  },
  { file: 'services/flags/tests/tracetest/rollout-transition.yaml', needsRunId: true },
  { file: 'services/donations/tests/tracetest/donation-create-publish.yaml', needsRunId: true },
]

const cli = process.argv.slice(2)
const defs: Def[] =
  cli.length > 0
    ? cli.map((file) => ({
        file,
        needsRunId: DEFAULT_DEFS.find((d) => d.file === file)?.needsRunId ?? false,
      }))
    : DEFAULT_DEFS

const serverUrl = process.env.TRACETEST_SERVER_URL
if (serverUrl) {
  const conf = spawnSync('tracetest', ['configure', '--server-url', serverUrl], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (conf.status !== 0) {
    process.stderr.write(`tracetest configure failed for ${serverUrl}:\n${conf.stderr ?? ''}\n`)
    process.exit(2)
  }
}

const runId = process.env.TRACETEST_RUN_ID ?? String(Date.now())

const results = defs.map((def) => {
  process.stdout.write(`▶ tracetest run ${def.file}\n`)
  const started = Date.now()
  const args = [
    'run',
    'test',
    '-f',
    def.file,
    ...(def.needsRunId ? ['--vars', `runId=${runId}`] : []),
    '--wait-for-result',
  ]
  const run = spawnSync('tracetest', args, { cwd: ROOT, encoding: 'utf8' })
  const duration_ms = Date.now() - started
  const passed = run.status === 0
  const tail = `${run.stdout ?? ''}${run.stderr ?? ''}`
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .slice(-6)
  if (!passed) process.stderr.write(`✗ ${def.file} red (exit ${run.status})\n`)
  return { file: def.file, passed, exit: run.status, duration_ms, tail }
})

const failed = results.filter((r) => !r.passed).length
const runner = {
  name: 'tracetest',
  passed: results.length - failed,
  failed,
  skipped: 0,
  duration_ms: results.reduce((sum, r) => sum + r.duration_ms, 0),
  output: { runner: 'tracetest-cli', success: failed === 0, run_id: runId, defs: results },
  seeds: {},
}

foldRunner(summaryPath, runner)
process.stdout.write(
  `merged tracetest runner into summary.json — ${runner.passed} def(s) passed, ${failed} failed\n`,
)
process.exit(failed === 0 ? 0 : 1)
