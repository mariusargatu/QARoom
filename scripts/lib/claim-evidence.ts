import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Claim } from '@qaroom/contracts/claims'

/**
 * Shared live-evidence resolver for the falsifiable-claim projections (`prove` CLI + `render-claims`).
 * Every claim's number is read here from the frozen `test-results/summary.json`: never hand-typed:  * with its provenance, so a stale/absent runner surfaces honestly rather than faking green.
 */

export interface Summary {
  commit?: string
  generated_at: string
  runners: { name: string; passed: number; failed: number; skipped: number }[]
}

export interface ResolvedEvidence {
  value: number | null
  provenance: string
  stale: boolean
}

export function loadSummary(root: string = process.cwd()): Summary | null {
  const path = resolve(root, 'test-results/summary.json')
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as Summary
}

function freshness(generatedAt: string): string {
  // Build tooling, not service runtime: Date.now() is fine here (the Clock rule covers the latter,
  // see scripts/lib/fold-runner.ts).
  const days = Math.max(0, Math.round((Date.now() - Date.parse(generatedAt)) / 86_400_000))
  return days <= 0 ? 'today' : `${days}d ago`
}

export function resolveEvidence(claim: Claim, summary: Summary | null): ResolvedEvidence {
  if (!summary) {
    return {
      value: null,
      provenance: 'no test-results/summary.json: run the suite first',
      stale: true,
    }
  }
  const runner = summary.runners.find((r) => r.name === claim.evidence.runner)
  if (!runner) {
    return {
      value: null,
      provenance: `runner '${claim.evidence.runner}' absent from summary.json`,
      stale: true,
    }
  }
  const commit = summary.commit ? summary.commit.slice(0, 7) : 'unknown'
  return {
    value: runner[claim.evidence.field],
    provenance: `summary.json · ${claim.evidence.runner} · commit ${commit} · ${freshness(summary.generated_at)}`,
    stale: false,
  }
}

export function gateLine(claim: Claim): string {
  const cwd = claim.gate.cwd ? `(${claim.gate.cwd}) ` : ''
  return `${cwd}${claim.gate.cmd} ${claim.gate.args.join(' ')}`
}
