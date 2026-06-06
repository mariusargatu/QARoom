import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { foldRunner } from './fold-runner'

/**
 * Fold a key-gated Python eval/red-team run into the frozen test-results/summary.json envelope
 * (ADR-0020 — the DeepEval/DeepTeam/PyRIT stack that superseded the OpenAI-bound Promptfoo runner).
 * The three runners share one output envelope (`{passed, failed, skipped, metrics, seed}`, written by
 * the suites under services/moderator-agent/evals/), so this is the single home for the fold — each
 * `<runner>-results.ts` is a one-line caller that only varies the runner name, the seed key, and any
 * extra `output{}` fields. The suite is key-gated: it writes its JSON only when a model key + the eval
 * group are present, so an ABSENT file means "skipped" — fold nothing and exit 0.
 */
export function foldEvalRunner(
  name: string,
  opts: {
    seedKey: string
    extraOutput?: (metrics: Record<string, unknown>) => Record<string, unknown>
  },
): never {
  const root = process.cwd()
  const summaryPath = resolve(root, 'test-results/summary.json')
  const outputPath = resolve(root, `services/moderator-agent/test-results/${name}-output.json`)

  if (!existsSync(outputPath)) {
    process.stderr.write(
      `no ${name} output at ${outputPath} — suite key-gated/skipped, nothing to fold\n`,
    )
    process.exit(0)
  }

  const report = JSON.parse(readFileSync(outputPath, 'utf8'))
  const passed: number = report?.passed ?? 0
  const failed: number = report?.failed ?? 0
  const skipped: number = report?.skipped ?? 0
  const metrics: Record<string, unknown> = report?.metrics ?? {}
  const seed: number = report?.seed ?? 0

  foldRunner(summaryPath, {
    name,
    passed,
    failed,
    skipped,
    duration_ms: 0,
    output: { runner: name, metrics, ...(opts.extraOutput?.(metrics) ?? {}) },
    seeds: { [opts.seedKey]: seed },
  })
  process.stdout.write(
    `merged ${name} runner into summary.json — ${passed} passed, ${failed} failed, ${skipped} skipped\n`,
  )
  process.exit(failed > 0 ? 1 : 0)
}
