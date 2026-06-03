import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TestResultsSummary } from '@qaroom/contracts/test-results-schema'

/**
 * Render the frozen `test-results/summary.json` into a GitHub Actions job-summary
 * (GFM: alert banner, shields badge, per-runner table, a Mermaid distribution pie, and a
 * collapsible replay-seeds panel). The report is DERIVED — it parses through the frozen
 * `TestResultsSummary` schema, so it cannot drift from the source of truth.
 *
 * Writes to `$GITHUB_STEP_SUMMARY` when set (CI), else stdout (local preview).
 */
const ROOT = process.cwd()
const summary = TestResultsSummary.parse(
  JSON.parse(readFileSync(resolve(ROOT, 'test-results/summary.json'), 'utf8')),
)

const GREEN = '2ea44f'
const RED = 'd73a49'
const shortName = (n: string) => n.replace(/^@qaroom\//, '')
const dur = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)
const rowStatus = (r: { failed: number }) => (r.failed === 0 ? '✅' : '❌')

const { totals, runners, commit, generated_at } = summary
const allGreen = totals.failed === 0
const totalMs = runners.reduce((s, r) => s + r.duration_ms, 0)
const byTests = [...runners].sort(
  (a, b) => b.passed + b.failed + b.skipped - (a.passed + a.failed + a.skipped),
)

const badgeMsg = allGreen ? `${totals.passed}_passed` : `${totals.failed}_failed`
const badge = `![tests](https://img.shields.io/badge/tests-${badgeMsg}-${allGreen ? GREEN : RED})`

const banner = allGreen
  ? `> [!TIP]\n> **All ${totals.passed} tests passed** across ${runners.length} runners — unit, property, contract, and migration suites green.`
  : `> [!CAUTION]\n> **${totals.failed} of ${totals.passed + totals.failed} tests failed** across ${runners.length} runners. See the table below.`

const tableRows = byTests
  .map(
    (r) =>
      `| \`${shortName(r.name)}\` | ${rowStatus(r)} | ${r.passed} | ${r.failed} | ${r.skipped} | ${dur(r.duration_ms)} |`,
  )
  .join('\n')

const pieSlices = byTests
  .map((r) => `    "${shortName(r.name)}" : ${r.passed + r.failed + r.skipped}`)
  .join('\n')

const seeded = runners.filter((r) => Object.keys(r.seeds).length > 0)
const seedsPanel =
  seeded.length === 0
    ? ''
    : `\n<details>\n<summary>🎲 Replay seeds</summary>\n\n| Runner | Seeds |\n|---|---|\n${seeded
        .map(
          (r) =>
            `| \`${shortName(r.name)}\` | ${Object.entries(r.seeds)
              .map(([k, v]) => `\`${k}=${String(v)}\``)
              .join(', ')} |`,
        )
        .join(
          '\n',
        )}\n\nReplay a failing property locally with \`VITEST_SEED=<n> pnpm test\`.\n</details>\n`

const report = `## 🧪 QARoom — test results

${badge}

${banner}

| Runner | Result | Passed | Failed | Skipped | Duration |
|---|:--:|--:|--:|--:|--:|
${tableRows}
| **Total** | ${allGreen ? '✅' : '❌'} | **${totals.passed}** | **${totals.failed}** | **${totals.skipped}** | **${dur(totalMs)}** |

\`\`\`mermaid
pie showData title Tests by runner
${pieSlices}
\`\`\`
${seedsPanel}
<sub>${commit ? `commit \`${commit.slice(0, 7)}\` · ` : ''}generated ${generated_at} · schema v${summary.schema_version} · source \`test-results/summary.json\`</sub>
`

const out = process.env.GITHUB_STEP_SUMMARY
if (out) {
  appendFileSync(out, `${report}\n`)
  process.stdout.write('wrote job summary to $GITHUB_STEP_SUMMARY\n')
} else {
  process.stdout.write(report)
}
