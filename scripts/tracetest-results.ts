import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
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

// The committed suite (mirrors ci.yml). Defs with `${var:runId}` need a unique per-run id so
// their Idempotency-Key does not hit idempotent replay and suppress the transition.
const DEFAULT_DEFS: string[] = [
  'services/content/tests/tracetest/post-created-publish.yaml',
  'services/content/tests/tracetest/feed-read.yaml',
  'services/content/tests/tracetest/create-missing-idempotency-key.yaml',
  'services/flags/tests/tracetest/rollout-transition.yaml',
  'services/donations/tests/tracetest/donation-create-publish.yaml',
]

const cli = process.argv.slice(2)
const defs: string[] = cli.length > 0 ? cli : DEFAULT_DEFS

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

// Tracetest CLI ≥1.x: runs WAIT by default (--wait-for-result is gone; -W skips waiting) and
// --vars takes a variable-set FILE, not key=value pairs — the ci.yml invocation this script
// originally lifted is older-CLI syntax and breaks on a current install. The varset is written
// fresh per invocation so the unique runId keeps dodging idempotent replay.
const varsPath = resolve(ROOT, 'test-results/tracetest-vars.yaml')
writeFileSync(
  varsPath,
  `type: VariableSet\nspec:\n  id: gauntlet-vars\n  name: gauntlet-vars\n  values:\n    - key: runId\n      value: "${runId}"\n`,
)

const results = defs.map((file) => {
  process.stdout.write(`▶ tracetest run ${file}\n`)
  const started = Date.now()
  // --vars goes to EVERY def (harmless when unused): the new CLI PROMPTS interactively for any
  // required-but-unsupplied variable, and a non-TTY run then spins forever redrawing the prompt
  // — the exit-null/giant-output failure mode the gauntlet hit on post-created-publish (which
  // also references ${var:runId}, unlike the old ci.yml invocation assumed).
  const args = ['run', 'test', '-f', file, '--vars', varsPath]
  const run = spawnSync('tracetest', args, { cwd: ROOT, encoding: 'utf8' })
  const duration_ms = Date.now() - started
  const passed = run.status === 0
  const tail = `${run.stdout ?? ''}${run.stderr ?? ''}`
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .slice(-6)
  if (!passed) process.stderr.write(`✗ ${file} red (exit ${run.status})\n`)
  return { file, passed, exit: run.status, duration_ms, tail }
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
