import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { foldRunner } from './lib/fold-runner'

/**
 * Fold a Promptfoo eval run into the frozen test-results/summary.json envelope as a `promptfoo`
 * runner (ADR-0017). Promptfoo writes its JSON report via `--output`; we read its stats. Run after
 * `pnpm --filter @qaroom/moderator-agent eval:run`:  pnpm promptfoo:results
 */
const ROOT = process.cwd()
const summaryPath = resolve(ROOT, 'test-results/summary.json')
const outputPath = resolve(ROOT, 'services/moderator-agent/evals/promptfoo-output.json')

if (!existsSync(outputPath)) {
  process.stderr.write(`no promptfoo output at ${outputPath} — run the eval first\n`)
  process.exit(2)
}

const report = JSON.parse(readFileSync(outputPath, 'utf8'))
const stats = report?.results?.stats ?? report?.stats ?? {}
const passed: number = stats.successes ?? 0
const failed: number = stats.failures ?? 0

const runner = {
  name: 'promptfoo',
  passed,
  failed,
  skipped: 0,
  duration_ms: 0,
  output: { runner: 'promptfoo', provider: 'openai', cases: passed + failed },
  seeds: { promptfoo_seed: 7 },
}

foldRunner(summaryPath, runner)
process.stdout.write(
  `merged promptfoo runner into summary.json — ${passed} passed, ${failed} failed\n`,
)
process.exit(failed > 0 ? 1 : 0)
