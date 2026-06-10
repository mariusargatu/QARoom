import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { foldRunner } from './lib/fold-runner'
import { PHASE_TITLES } from './lib/gauntlet-plan'
import type { StepRecord } from './lib/gauntlet-steps'

/**
 * Render test-results/gauntlet/report.md from the run journal (steps.jsonl) + the summary
 * envelope, and fold a `gauntlet` meta-runner. Derived-only: every number comes from an
 * artifact, nothing is hand-typed (the render-stats discipline applied to the gauntlet).
 * Run as the gauntlet's final step or standalone after any partial run:  pnpm gauntlet:report
 */
const ROOT = process.cwd()
const stepsPath = resolve(ROOT, 'test-results/gauntlet/steps.jsonl')
const summaryPath = resolve(ROOT, 'test-results/summary.json')
const reportPath = resolve(ROOT, 'test-results/gauntlet/report.md')

if (!existsSync(stepsPath)) {
  process.stderr.write('no test-results/gauntlet/steps.jsonl — run pnpm gauntlet first\n')
  process.exit(2)
}

interface RunMeta {
  type?: string
  ts: string
  commit?: string
  flags?: string[]
  preflight?: Record<string, boolean>
}
const lines = readFileSync(stepsPath, 'utf8')
  .split('\n')
  .filter((l) => l.trim().length > 0)
  .map((l) => JSON.parse(l) as StepRecord & RunMeta)

// The journal is append-only across runs; report the LAST run (from the final run-start marker).
const lastStart = lines
  .map((l, i) => (l.type === 'run-start' ? i : -1))
  .reduce((a, b) => Math.max(a, b), -1)
const run = lines.slice(lastStart === -1 ? 0 : lastStart)
const meta = (lastStart === -1 ? {} : lines[lastStart]) as RunMeta
const steps = run.filter((l) => l.type === undefined) as StepRecord[]

const byStatus = (s: string) => steps.filter((r) => r.status === s)
const reds = byStatus('red')
const wallMs = steps.reduce((sum, r) => sum + r.duration_ms, 0)
const fmtDur = (ms: number) =>
  ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}min` : `${Math.round(ms / 1000)}s`

const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null

const md: string[] = []
md.push('# Gauntlet report')
md.push('')
md.push(
  `Run @ \`${meta.commit?.slice(0, 8) ?? 'unknown'}\` — ${byStatus('green').length} green, ${reds.length} red, ${byStatus('skipped').length} skipped, ${byStatus('observed').length} observed. Active step time ${fmtDur(wallMs)}.`,
)
md.push('')

if (reds.length > 0) {
  md.push('## Findings (red gates)')
  md.push('')
  for (const r of reds) md.push(`- **${r.name}** (phase ${r.phase}, exit ${r.exit}) — \`${r.log}\``)
  md.push('')
}

md.push('## Phases')
md.push('')
md.push('| phase | step | class | status | duration |')
md.push('|---|---|---|---|---|')
let prevPhase = -1
for (const r of steps) {
  const title = r.phase !== prevPhase ? `${r.phase} ${PHASE_TITLES[r.phase] ?? ''}` : ''
  prevPhase = r.phase
  md.push(
    `| ${title} | ${r.name} | ${r.class} | ${r.status}${r.reason ? ` (${r.reason})` : ''} | ${fmtDur(r.duration_ms)} |`,
  )
}
md.push('')

if (summary) {
  md.push('## Evidence (summary.json runners)')
  md.push('')
  md.push('| runner | passed | failed | skipped |')
  md.push('|---|---|---|---|')
  for (const r of summary.runners ?? []) {
    md.push(`| ${r.name} | ${r.passed} | ${r.failed} | ${r.skipped} |`)
  }
  md.push('')
}

md.push('## Known issues routed around')
md.push('')
md.push(
  '- `k6-donation-known-issue`: Microcks payment mock 404s POST /charges → in-cluster donations 502 (observe-class; artifact at `test-results/known-issue-k6-donation.json`).',
)
md.push(
  '- Chaos experiments 06/08: Litmus HTTPChaos pending ChaosCenter setup (ADR-0014) — honest skips in the chaos runner.',
)
md.push('')
writeFileSync(reportPath, `${md.join('\n')}\n`)
process.stdout.write(`wrote ${reportPath}\n`)

const skipped = byStatus('skipped')
foldRunner(summaryPath, {
  name: 'gauntlet',
  passed: byStatus('green').length,
  failed: reds.length,
  skipped: skipped.length,
  duration_ms: wallMs,
  output: {
    runner: 'gauntlet-orchestrator',
    commit: meta.commit,
    flags: meta.flags ?? [],
    observed: byStatus('observed').map((r) => r.name),
    reds: reds.map((r) => r.name),
    skips: skipped.map((r) => ({ name: r.name, reason: r.reason })),
  },
  seeds: {},
})
process.stdout.write('merged gauntlet runner into summary.json\n')
// The renderer is a projection, not a gate: the RUN's exit code already carries the findings.
// Exiting non-zero here only painted the report step red for doing its job correctly.
