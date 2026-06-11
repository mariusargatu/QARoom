import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * `pnpm chaos:verify`: the chaos-experiment count gate (sibling of tour:verify / mcp:verify). The
 * chaos-experiments/README.md table is hand-authored prose — its rich per-row columns (steady-state
 * property, mitigation, status) cannot be machine-derived from the YAML, so it is not generated.
 * But the COUNT can lie, and once did: the header said "seven experiments" with a 7-row table while
 * manifest 08 (webhook receiver, Milestone 11) sat on disk unreferenced. This gate pins the count so
 * that drift cannot recur:
 *
 *   1. COVERED   every top-level chaos-experiments/<NN>-*.yaml manifest is named in the README.
 *   2. ROW COUNT the README table has exactly one data row per manifest (no phantom rows, no gaps).
 *
 * Pure filesystem — no summary.json or cluster — so it runs in the always-on CI verify lane, unlike
 * the manual-dispatch claims job. Exits non-zero on any mismatch, so a new manifest cannot ship
 * without its README row (and vice versa).
 */

const ROOT = process.cwd()
const DIR = resolve(ROOT, 'chaos-experiments')
const README = resolve(DIR, 'README.md')

// A data row in the experiments table: `| <n> | `<slug>.yaml` | ...`. The header (`| # | Manifest`)
// and the separator (`|---|`) are excluded because neither starts with a digit cell.
const DATA_ROW = /^\|\s*\d+\s*\|/

function verify(): string[] {
  const failures: string[] = []

  if (!existsSync(DIR)) return ['chaos-experiments/ does not exist']
  if (!existsSync(README)) return ['chaos-experiments/README.md does not exist']

  const manifests = readdirSync(DIR)
    .filter((f) => /^\d{2}-.*\.ya?ml$/.test(f))
    .sort()
  const readme = readFileSync(README, 'utf8')
  const rowCount = readme.split('\n').filter((line) => DATA_ROW.test(line)).length

  for (const manifest of manifests) {
    if (!readme.includes(manifest)) {
      failures.push(`manifest ${manifest} is not referenced in chaos-experiments/README.md`)
    }
  }

  if (rowCount !== manifests.length) {
    failures.push(
      `README table has ${rowCount} data row(s) but ${manifests.length} manifest(s) exist on disk`,
    )
  }

  process.stdout.write(`chaos:verify: ${manifests.length} manifest(s), ${rowCount} table row(s)\n`)
  return failures
}

function main(): void {
  const failures = verify()
  if (failures.length > 0) {
    for (const f of failures) process.stderr.write(`  ✗ ${f}\n`)
    process.stderr.write(
      `\nchaos:verify FAILED: ${failures.length} drift(s); add the missing README row or manifest\n`,
    )
    process.exit(1)
  }
  process.stdout.write(`chaos:verify ✓: every chaos manifest has exactly one README table row\n`)
}

main()
