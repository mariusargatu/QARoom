import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { foldRunner } from './lib/fold-runner'

/**
 * Fold the SME-labelled golden dataset's agreement report into test-results/summary.json as a
 * `golden-sme` runner (Commitment 14). `passed` = cases promoted to gold (unanimous), `skipped` =
 * ambiguous cases held out; the Fleiss' Kappa rides the extensible output. Run after
 * `pnpm --filter @qaroom/moderator-agent golden:build`:  pnpm golden:results
 */
const ROOT = process.cwd()
const summaryPath = resolve(ROOT, 'test-results/summary.json')
const goldPath = resolve(ROOT, 'services/moderator-agent/evals/golden/gold.json')

if (!existsSync(goldPath)) {
  process.stderr.write(`no gold dataset at ${goldPath} — run golden:build first\n`)
  process.exit(2)
}

const gold = JSON.parse(readFileSync(goldPath, 'utf8'))
const runner = {
  name: 'golden-sme',
  passed: gold.n_gold ?? 0,
  failed: 0,
  skipped: gold.n_ambiguous ?? 0,
  duration_ms: 0,
  output: {
    runner: 'sme-golden',
    n_raters: gold.n_raters,
    n_items: gold.n_items,
    fleiss_kappa_verdict: gold.fleiss_kappa_verdict,
    kappa_interpretation: gold.kappa_interpretation,
    percent_unanimous: gold.percent_unanimous,
    n_gold: gold.n_gold,
    n_ambiguous: gold.n_ambiguous,
  },
  seeds: {},
}

foldRunner(summaryPath, runner)
process.stdout.write(
  `merged golden-sme runner — Fleiss Kappa=${gold.fleiss_kappa_verdict} (${gold.kappa_interpretation}), ` +
    `${gold.n_gold} gold / ${gold.n_ambiguous} ambiguous of ${gold.n_items} (${gold.n_raters} SMEs)\n`,
)
