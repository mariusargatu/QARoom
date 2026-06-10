import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { foldRunner } from './lib/fold-runner'

/**
 * Per-killer mutation attribution: which technique actually kills the mutants — property suites
 * or example-based specs? Reads the committed Stryker JSON reports (killedBy/coveredBy per
 * mutant + testFiles), classifies each killing test by its file (`.property.` / `.pbt.` ⇒
 * property), and folds a `stryker-attribution` runner. Evidence, not a gate: there is no honest
 * env toggle for "property tests pull their weight", so this stays out of claims.ts and feeds
 * the detection-matrix analysis instead (H5: do mutation scores predict matrix blindness?).
 *
 * Meaningful only where the per-package vitest.stryker.config.ts includes BOTH techniques over
 * the same mutated module (gateway + donations after the Session-5 widening; contracts and
 * service-kit are single-technique scopes and report as such).
 *
 *   pnpm stryker:critical && pnpm stryker:attribution
 */
const ROOT = process.cwd()
const summaryPath = resolve(ROOT, 'test-results/summary.json')
const PACKAGES = ['contracts', 'donations', 'gateway', 'service-kit']

interface StrykerTest {
  id: string
  name?: string
}
interface StrykerTestFile {
  tests?: StrykerTest[]
}
interface StrykerMutant {
  status?: string
  killedBy?: string[]
  coveredBy?: string[]
}
interface StrykerReport {
  files?: Record<string, { mutants?: StrykerMutant[] }>
  testFiles?: Record<string, StrykerTestFile>
}

const isProperty = (file: string) => /\.(property|pbt)\./.test(file)

const results = PACKAGES.flatMap((pkg) => {
  const reportPath = resolve(ROOT, `test-results/stryker-${pkg}.json`)
  if (!existsSync(reportPath)) {
    process.stderr.write(`  (no test-results/stryker-${pkg}.json — run pnpm stryker:critical)\n`)
    return []
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as StrykerReport

  const testToGroup = new Map<string, 'property' | 'example'>()
  for (const [file, tf] of Object.entries(report.testFiles ?? {})) {
    for (const t of tf.tests ?? []) {
      testToGroup.set(t.id, isProperty(file) ? 'property' : 'example')
    }
  }
  const techniques = new Set(testToGroup.values())

  let propertyOnly = 0
  let exampleOnly = 0
  let both = 0
  let killed = 0
  let survivedOrUncovered = 0
  for (const f of Object.values(report.files ?? {})) {
    for (const m of f.mutants ?? []) {
      if (m.status !== 'Killed' && m.status !== 'Timeout') {
        if (m.status === 'Survived' || m.status === 'NoCoverage') survivedOrUncovered += 1
        continue
      }
      killed += 1
      const groups = new Set((m.killedBy ?? []).map((id) => testToGroup.get(id)).filter(Boolean))
      if (groups.has('property') && groups.has('example')) both += 1
      else if (groups.has('property')) propertyOnly += 1
      else if (groups.has('example')) exampleOnly += 1
    }
  }

  return [
    {
      package: pkg,
      techniques_in_scope: [...techniques].sort(),
      killed,
      survived_or_uncovered: survivedOrUncovered,
      property_only_kills: propertyOnly,
      example_only_kills: exampleOnly,
      both_kill: both,
      single_technique_scope: techniques.size < 2,
    },
  ]
})

if (results.length === 0) {
  process.stderr.write('no stryker reports found — run pnpm stryker:critical first\n')
  process.exit(2)
}

for (const r of results) {
  process.stdout.write(
    `  ${r.package.padEnd(12)} killed=${String(r.killed).padEnd(4)} property-only=${String(r.property_only_kills).padEnd(4)} example-only=${String(r.example_only_kills).padEnd(4)} both=${String(r.both_kill).padEnd(4)}${r.single_technique_scope ? ' (single-technique scope)' : ''}\n`,
  )
}

foldRunner(summaryPath, {
  name: 'stryker-attribution',
  passed: results.length,
  failed: 0,
  skipped: PACKAGES.length - results.length,
  duration_ms: 0,
  output: { runner: 'stryker-killedby-attribution', packages: results },
  seeds: {},
})
process.stdout.write('merged stryker-attribution runner into summary.json\n')
