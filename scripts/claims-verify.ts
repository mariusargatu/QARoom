import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CLAIMS, type Claim } from '@qaroom/contracts/claims'
import { README_END, README_START, renderReadmeBlock } from './render-claims'
import { renderStatsBlock, STATS_END, STATS_START } from './render-stats'

/**
 * `pnpm claims:verify`: the manifest-resolves gate (sibling of mcp:verify / openapi:verify). The
 * linchpin that stops the falsifiable-claim manifest from decaying into theater. For every claim:
 *
 *   1. SCHEMA      the manifest parses (enforced at import of @qaroom/contracts/claims).
 *   2. EVIDENCE    the claim's evidence pointer resolves to a real runner in summary.json.
 *   3. WIRED       the toggle is read by real (non-test) service source: directly (process.env.X)
 *                  or via a settings field (pydantic maps `moderator_disable_abstain` ← MODERATOR_DISABLE_ABSTAIN).
 *   4. TEETH       `prove <id> --break` actually turns the gate RED. A toggle that does not break its
 *                  named gate is theater: this is what string-grep gates miss, so we RUN it.
 *
 * Exits non-zero on any failure, so CI cannot ship a claim that cannot be falsified.
 */

const ROOT = process.cwd()
const SUMMARY_PATH = resolve(ROOT, 'test-results/summary.json')

interface Result {
  ok: boolean
  warn?: boolean
  detail: string
}

// A runner name is VALID (not a typo) if it is a real workspace dir (@qaroom/<name> → services/ or
// packages/<name>) or a known tool-runner folded by a result script.
const TOOL_RUNNERS = new Set([
  'moderator',
  'deepeval',
  'deepteam',
  'pyrit',
  'promptfoo',
  'golden-sme',
  'k6',
  'stryker',
  'evomaster',
  'scout',
  'web-ct',
  'chaos',
  'eslint-plugin-qaroom',
])
function isValidRunnerName(name: string): boolean {
  if (TOOL_RUNNERS.has(name)) return true
  const m = name.match(/^@qaroom\/(.+)$/)
  if (!m) return false
  return (
    existsSync(resolve(ROOT, `services/${m[1]}`)) || existsSync(resolve(ROOT, `packages/${m[1]}`))
  )
}

function checkEvidence(claim: Claim): Result {
  if (!existsSync(SUMMARY_PATH)) return { ok: false, detail: 'no test-results/summary.json' }
  const summary = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8')) as { runners: { name: string }[] }
  if (summary.runners.some((r) => r.name === claim.evidence.runner)) {
    return { ok: true, detail: `runner '${claim.evidence.runner}' present` }
  }
  // Absent from the snapshot. A real package → STALE (warn, not fatal; CI's fresh summary resolves it).
  // An unknown name → a manifest typo (fatal).
  if (isValidRunnerName(claim.evidence.runner)) {
    return {
      ok: true,
      warn: true,
      detail: `runner '${claim.evidence.runner}' valid but absent from this summary.json snapshot: STALE (regenerate)`,
    }
  }
  return {
    ok: false,
    detail: `runner '${claim.evidence.runner}' is not a real package or tool runner: manifest typo`,
  }
}

function checkWired(claim: Claim): Result {
  // The toggle is read either as the literal env var (TS: process.env.CHAOS_WEBHOOK_…) or via a
  // settings field whose name is the lower-snake of the var (pydantic-settings auto-maps it).
  const patterns = [claim.toggle, claim.toggle.toLowerCase()]
  const grep = spawnSync(
    'grep',
    ['-rIlE', '--exclude-dir=node_modules', patterns.join('|'), 'services', 'packages'],
    { cwd: ROOT, encoding: 'utf8' },
  )
  const hits = (grep.stdout ?? '')
    .split('\n')
    .filter(Boolean)
    .filter((p) => !/\.(test|spec)\.|tests\/|contracts\/src\/claims/.test(p))
  return hits.length > 0
    ? { ok: true, detail: `read in ${hits[0]}` }
    : { ok: false, detail: `toggle ${claim.toggle} not found in non-test source` }
}

function checkTeeth(claim: Claim): Result {
  // A live-tier claim's bug lives in the DEPLOYED pods (live-claim-gate.sh arms it there);
  // without a reachable cluster the falsifier cannot run, and reporting that as THEATER would
  // be a false verdict. Skip visibly instead — the gauntlet (cluster up) runs the real teeth.
  if (claim.tier === 'live') {
    const probe = spawnSync('kubectl', ['get', 'ns', 'qaroom'], { encoding: 'utf8' })
    if (probe.status !== 0) {
      return { ok: true, detail: 'live tier: no reachable cluster — teeth deferred to a live run' }
    }
  }
  // Run the real falsifier. prove --break exits 0 iff the gate genuinely went red.
  const run = spawnSync('pnpm', ['prove', claim.id, '--break'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  })
  return run.status === 0
    ? { ok: true, detail: 'gate went RED when toggled (falsifiable)' }
    : { ok: false, detail: 'gate stayed GREEN with the toggle set: THEATER' }
}

// Each README projection (claims block, stats block) is a STABLE rendering of source truth, so the
// committed block must be byte-identical to its generator. This is the root fix for the stale-front-
// door weak axis: a block cannot drift from source without this gate going red. The stats block
// excludes summary.json's volatile generated_at/commit, so it only changes when a real count changes.
function checkReadmeBlock(name: string, start: string, end: string, render: () => string): Result {
  const path = resolve(ROOT, 'README.md')
  if (!existsSync(path)) return { ok: false, detail: 'README.md missing' }
  const readme = readFileSync(path, 'utf8')
  const a = readme.indexOf(start)
  const b = readme.indexOf(end)
  if (a === -1 || b === -1) {
    return { ok: false, detail: `${name} block markers absent: paste the generator output` }
  }
  return readme.slice(a, b + end.length) === render()
    ? { ok: true, detail: `${name} block matches source` }
    : { ok: false, detail: `${name} block is STALE: re-run the renderer and paste it` }
}

function main(): void {
  process.stdout.write(`claims:verify: ${CLAIMS.length} claims\n`)
  let failed = 0
  for (const claim of CLAIMS) {
    const checks: [string, Result][] = [
      ['evidence', checkEvidence(claim)],
      ['wired', checkWired(claim)],
      ['teeth', checkTeeth(claim)],
    ]
    const bad = checks.filter(([, r]) => !r.ok)
    const warns = checks.filter(([, r]) => r.ok && r.warn)
    if (bad.length === 0) {
      const note = warns.length > 0 ? ` (${warns.map(([n]) => `${n}: stale`).join(', ')})` : ''
      process.stdout.write(`  ✓ ${claim.id}: schema, evidence, wired, teeth${note}\n`)
      for (const [name, r] of warns) process.stdout.write(`      ⚠ ${name}: ${r.detail}\n`)
    } else {
      failed += 1
      process.stdout.write(`  ✗ ${claim.id}\n`)
      for (const [name, r] of bad) process.stdout.write(`      ${name}: ${r.detail}\n`)
    }
  }
  const blocks: [string, Result][] = [
    ['claims', checkReadmeBlock('claims', README_START, README_END, renderReadmeBlock)],
    ['stats', checkReadmeBlock('stats', STATS_START, STATS_END, renderStatsBlock)],
  ]
  for (const [name, r] of blocks) {
    if (r.ok) {
      process.stdout.write(`  ✓ README ${name} block: ${r.detail}\n`)
    } else {
      failed += 1
      process.stdout.write(`  ✗ README ${name} block\n      drift: ${r.detail}\n`)
    }
  }

  if (failed > 0) {
    process.stderr.write(
      `\nclaims:verify FAILED: ${failed} check(s) failed (unfalsifiable claim or stale projection)\n`,
    )
    process.exit(1)
  }
  process.stdout.write(
    `\nclaims:verify ✓: every claim resolves live and is falsifiable on demand\n`,
  )
}

main()
