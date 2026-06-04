import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CoverageReport } from 'monocart-coverage-reports'

/**
 * Unified coverage (Milestone 8, ADR-0005). Reconciles Vitest's V8 coverage with Playwright
 * Component Testing's Istanbul coverage into ONE report — a plain `nyc merge` cannot mix the two
 * formats, but `monocart-coverage-reports` normalizes both. Output `coverage/merged/lcov.info`
 * feeds the `test-results/summary.json` discipline (and, later, the Sonar gate).
 *
 * Inputs (run these first; both browser/coverage-gated):
 *   - Vitest V8:        `coverage/coverage-final.json`            (vitest run --coverage)
 *   - CT Istanbul:      `.nyc_output/playwright_coverage_*.json`  (ct:coverage → playwright/index.ts fixture)
 */
const report = new CoverageReport({
  name: 'QARoom web — unified coverage',
  outputDir: resolve('coverage/merged'),
  reports: ['console-summary', 'lcovonly', 'json'],
  sourceFilter: (path: string) =>
    path.includes('/src/') &&
    !path.includes('node_modules') &&
    !/\.(stories|ct|test|spec)\./.test(path) &&
    !path.endsWith('/index.ts'),
})

const v8Path = resolve('coverage/coverage-final.json')
if (existsSync(v8Path)) {
  await report.add(JSON.parse(readFileSync(v8Path, 'utf8')))
  process.stdout.write('added Vitest V8 coverage\n')
}

const nycDir = resolve('.nyc_output')
if (existsSync(nycDir)) {
  for (const file of readdirSync(nycDir).filter((n) => n.endsWith('.json'))) {
    await report.add(JSON.parse(readFileSync(resolve(nycDir, file), 'utf8')))
  }
  process.stdout.write('added Playwright CT Istanbul coverage\n')
}

const summary = await report.generate()
process.stdout.write(
  `merged coverage written to coverage/merged (${summary.summary.lines.pct}% lines)\n`,
)
