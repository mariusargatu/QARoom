import { globSync } from 'node:fs'
import { resolve } from 'node:path'
import { foldRunner } from './lib/fold-runner'

/**
 * Fold an EvoMaster nightly run into the frozen test-results/summary.json envelope as an `evomaster`
 * runner. The schema is do-not-touch; EvoMaster rides its extensible `output`. The gate is
 * DETERMINISTIC — "ran and emitted ≥1 test file" — never the stochastic fault count (black-box
 * search is random; ADR-0016). Run after `pnpm evomaster`:  pnpm evomaster:results
 */
const ROOT = process.cwd()
const summaryPath = resolve(ROOT, 'test-results/summary.json')
const generatedDir = 'services/content/tests/evomaster-generated'

const testFiles = globSync(`${generatedDir}/*_Test.js`, { cwd: ROOT })
const emitted = testFiles.length

const evomasterRunner = {
  name: 'evomaster',
  passed: emitted > 0 ? 1 : 0,
  failed: emitted > 0 ? 0 : 1,
  skipped: 0,
  duration_ms: 0,
  output: {
    runner: 'evomaster',
    version: 'v6.0.0',
    mode: 'blackBox',
    success: emitted > 0,
    test_files_emitted: emitted,
    files: testFiles.map((f) => f.replace(`${generatedDir}/`, '')),
  },
  seeds: { evomaster: Number(process.env.EVOMASTER_SEED ?? 42) },
}

foldRunner(summaryPath, evomasterRunner)
process.stdout.write(`merged evomaster runner into summary.json — ${emitted} test files emitted\n`)
process.exit(emitted > 0 ? 0 : 1)
