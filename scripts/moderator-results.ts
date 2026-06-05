import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { foldRunner } from './lib/fold-runner'

/**
 * Fold the Python moderator-agent pytest run into the frozen test-results/summary.json envelope as a
 * `moderator` runner (Commitment 14 — every runner, in any language, emits structured output). The
 * counts come from the pytest sessionfinish hook (services/moderator-agent/tests/conftest.py).
 * Run after `pnpm --filter @qaroom/moderator-agent test`:  pnpm moderator:results
 */
const ROOT = process.cwd()
const summaryPath = resolve(ROOT, 'test-results/summary.json')
const pytestSummary = resolve(ROOT, 'services/moderator-agent/test-results/pytest-summary.json')

if (!existsSync(pytestSummary)) {
  process.stderr.write(`no pytest summary at ${pytestSummary} — run the moderator pytest first\n`)
  process.exit(2)
}

const counts = JSON.parse(readFileSync(pytestSummary, 'utf8'))
const runner = {
  name: 'moderator',
  passed: counts.passed ?? 0,
  failed: counts.failed ?? 0,
  skipped: counts.skipped ?? 0,
  duration_ms: 0,
  output: { runner: 'pytest', service: 'moderator-agent' },
  seeds: {},
}

foldRunner(summaryPath, runner)
process.stdout.write(
  `merged moderator runner into summary.json — ${runner.passed} passed, ${runner.failed} failed\n`,
)
process.exit(runner.failed > 0 ? 1 : 0)
