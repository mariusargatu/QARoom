import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BOUNDARY_REGISTRY } from './lib/manifests/boundary-registry'
import { CLAIMS, type Claim } from './lib/manifests/claims'
import { BOUNDARIES_END, BOUNDARIES_START, renderBoundariesBlock } from './render-boundaries'
import { README_END, README_START, renderClaimsMarkdown, renderReadmeBlock } from './render-claims'
import { COST_END, COST_START, renderCostBlock } from './render-cost'
import { renderStatsBlock, STATS_END, STATS_START } from './render-stats'
import { deriveFoldedRunnerNames } from './test-results-verify'

/**
 * `pnpm claims:verify`: the manifest-derived evidence gate (sibling of mcp:verify / openapi:verify).
 * One mission — the manifest-derived evidence layer cannot decay into UNFALSIFIABLE claims OR STALE
 * front-door projections. Two halves:
 *
 * A. PER CLAIM (the falsifiable-claim manifest in ./lib/manifests/claims):
 *   1. SCHEMA      the manifest parses (enforced at import of ./lib/manifests/claims).
 *   2. EVIDENCE    the claim's evidence pointer resolves to a real runner in summary.json.
 *   3. WIRED       the toggle is read by real (non-test) service source: directly (process.env.X)
 *                  or via a settings field (pydantic maps `moderator_disable_abstain` ← MODERATOR_DISABLE_ABSTAIN).
 *   4. TEETH       `prove <id> --break` actually turns the gate RED. A toggle that does not break its
 *                  named gate is theater: this is what string-grep gates miss, so we RUN it.
 *
 * B. FRONT-DOOR PROJECTIONS (each committed block must be byte-identical to its generator, so a
 *    hand-edit cannot let the numbers a reader sees drift from the manifests):
 *   - the ARCHITECTURE.md boundary / claims / cost / stats blocks (render-boundaries/claims/cost/stats),
 *   - docs/claims.md (the rendered claims-manifest projection, checkClaimsPage),
 *   - the AGENTS.md commands census (every documented `pnpm` command resolves to a real script).
 *
 * Exits non-zero on any failure, so CI cannot ship a claim that cannot be falsified or a front-door
 * projection that has gone stale.
 */

const ROOT = process.cwd()
const SUMMARY_PATH = resolve(ROOT, 'test-results/summary.json')

interface Result {
  ok: boolean
  warn?: boolean
  /** ok, but the real falsifier could not run here (live tier, no reachable cluster). Tallied apart. */
  deferred?: boolean
  detail: string
}

// A runner name is VALID (not a typo) if it is a real workspace dir (@qaroom/<name> → services/ or
// packages/<name>) or a known tool-runner. The tool-runner half is DERIVED from the *-results.ts
// scripts (shared with test-results:verify's census) so it cannot rot — that derivation is what
// removes the M12-dropped 'promptfoo' and adds 'journey'/'web-e2e' without a hand-edit here.
const EXTRA_VALID_RUNNERS = new Set([
  // Valid runner names NOT folded by a *-results.ts (so the derivation can't see them):
  // tenant-spans backs the tenant-span-everywhere claim (folded by check-tenant-spans.ts --fold);
  // eslint-plugin-qaroom is folded by the vitest aggregate under its bare (unscoped) package name;
  // the rest are max-out fold-runners the gauntlet/matrix emit that a future claim may reference.
  'tenant-spans',
  'eslint-plugin-qaroom',
  'scout',
  'gauntlet',
])
const TOOL_RUNNERS = new Set([...deriveFoldedRunnerNames(), ...EXTRA_VALID_RUNNERS])
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

// One boundary vocabulary everywhere: the claim's reader-facing row must exist in the registry,
// and its gate lane must be one the registry row actually maps (the 2026-06-11 critique caught
// webhook-signing shown as `trust` while the breadth table put HMAC at the delivery edge).
function checkTaxonomy(claim: Claim): Result {
  const row = BOUNDARY_REGISTRY.find((b) => b.id === claim.registryRow)
  if (!row) {
    return {
      ok: false,
      detail: `registryRow '${claim.registryRow}' is not in boundary-registry.ts`,
    }
  }
  if (!row.lanes.includes(claim.boundary)) {
    return {
      ok: false,
      detail: `lane '${claim.boundary}' is not mapped by registry row '${claim.registryRow}' (lanes: ${row.lanes.join(', ') || 'none'})`,
    }
  }
  return { ok: true, detail: `row '${claim.registryRow}' maps lane '${claim.boundary}'` }
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
  // A live-tier claim's bug lives in the DEPLOYED pods (live-claim-gate.sh → live-toggle.sh arms it
  // there, gates, reverts). A reachable cluster is NECESSARY BUT NOT SUFFICIENT: a local `pnpm verify`
  // against a cluster that is up but not primed runs the audit over pre-arming (clean) spans, the gate
  // goes a FALSE green, and a real claim is mislabelled THEATER. So attempt the live falsifier only
  // under an explicit opt-in — the gauntlet's cluster lane sets LIVE_TEETH=1, where the cluster is
  // deliberately primed — and otherwise DEFER. Deferred is a first-class, tallied outcome ("re-run on
  // the cluster"), never a silent pass: the real teeth still run, just where they can actually arm the
  // bug, so a dev with an idle cluster up no longer turns a live claim into theatre.
  if (claim.tier === 'live') {
    const optedIn = process.env.LIVE_TEETH === '1'
    const reachable =
      optedIn && spawnSync('kubectl', ['get', 'ns', 'qaroom'], { encoding: 'utf8' }).status === 0
    if (!reachable) {
      return {
        ok: true,
        deferred: true,
        detail: optedIn
          ? 'live tier: no reachable cluster — teeth deferred to a live run'
          : 'live tier: teeth deferred to a primed live run (set LIVE_TEETH=1 with the cluster up)',
      }
    }
  }
  // Run the real falsifier. prove --break exits 0 = gate went red (falsifiable), 1 = gate stayed
  // green (THEATER), 2 = the gate could not run at all (a missing prerequisite like `uv`). All three
  // non-zero outcomes fail the gate, but 2 must NOT read as THEATER: the teeth never ran, so the
  // honest verdict is "prerequisite missing", not "claim is theater" (that distinction is the whole
  // point — a no-uv box cannot silently pass the moderator teeth).
  const run = spawnSync('pnpm', ['prove', claim.id, '--break'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  })
  if (run.status === 0) return { ok: true, detail: 'gate went RED when toggled (falsifiable)' }
  if (run.status === 2) {
    return {
      ok: false,
      detail: `gate could not run (missing prerequisite for \`${claim.gate.cmd}\`): teeth never ran`,
    }
  }
  return { ok: false, detail: 'gate stayed GREEN with the toggle set: THEATER' }
}

// Each front-door projection (README claims/stats blocks) is a STABLE rendering of source truth,
// so the committed block must be byte-identical to its generator. This is the root fix for the
// stale-front-door weak axis: a block cannot drift from source without this gate going red. The
// blocks exclude summary.json's volatile generated_at/commit, so they only change when a real
// count changes.
function checkBlock(
  file: string,
  name: string,
  start: string,
  end: string,
  render: () => string,
): Result {
  const path = resolve(ROOT, file)
  if (!existsSync(path)) return { ok: false, detail: `${file} missing` }
  const text = readFileSync(path, 'utf8')
  const a = text.indexOf(start)
  const b = text.indexOf(end)
  if (a === -1 || b === -1) {
    return {
      ok: false,
      detail: `${name} block markers absent in ${file}: paste the generator output`,
    }
  }
  return text.slice(a, b + end.length) === render()
    ? { ok: true, detail: `${name} block matches source` }
    : { ok: false, detail: `${name} block in ${file} is STALE: re-run the renderer and paste it` }
}

// docs/claims.md no longer carries live numbers (the verdict columns were dropped — it is now a pure
// manifest projection: claim, boundary, toggle, falsify command). That makes it byte-gateable like
// the ARCHITECTURE.md block, so gate it that way: the committed page must be byte-identical to
// `renderClaimsMarkdown()`. A row-COUNT check let a reword/rename of any claim drift the front-door
// page silently while the count stayed N == CLAIMS.length — the exact stale-front-door failure this
// machinery exists to prevent.
function checkClaimsPage(): Result {
  const mdPath = resolve(ROOT, 'docs/claims.md')
  if (!existsSync(mdPath)) {
    return { ok: false, detail: 'docs/claims.md missing: run pnpm claims:render' }
  }
  return readFileSync(mdPath, 'utf8') === renderClaimsMarkdown()
    ? {
        ok: true,
        detail: `claims.md is byte-identical to the manifest projection (${CLAIMS.length} claims)`,
      }
    : { ok: false, detail: 'docs/claims.md is STALE: re-run pnpm claims:render and commit' }
}

// Root AGENTS.md is the agent front door, and its Commands block rots the same way the README
// once did (a renamed script leaves a dead `pnpm <x>` that every agent then walks into). Census:
// every `pnpm <script>` named in the fenced Commands block must exist in root package.json
// scripts. `pnpm --filter <pkg> …` forms are per-package scripts outside the root census and
// never match (the captured token must start with a letter); pnpm builtins are allowlisted.
const PNPM_BUILTINS = new Set(['install', 'add', 'exec', 'run', 'dlx'])

function checkCommandsCensus(): Result {
  const agentsPath = resolve(ROOT, 'AGENTS.md')
  if (!existsSync(agentsPath)) return { ok: false, detail: 'AGENTS.md missing' }
  const block = readFileSync(agentsPath, 'utf8').match(/## Commands\n+```bash\n([\s\S]*?)```/)
  const body = block?.[1]
  if (body === undefined) {
    return { ok: false, detail: 'no ```bash fenced block under ## Commands in AGENTS.md' }
  }
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
  const tokens = [...body.matchAll(/pnpm\s+([a-z][a-z0-9:_-]*)/g)]
    .map((m) => m[1])
    .filter((name): name is string => name !== undefined)
  const named = [...new Set(tokens)]
  const missing = named.filter((name) => !PNPM_BUILTINS.has(name) && !(name in pkg.scripts))
  return missing.length === 0
    ? { ok: true, detail: `${named.length} commands named, all resolve to root scripts` }
    : {
        ok: false,
        detail: `AGENTS.md Commands block names script(s) missing from package.json: ${missing.join(', ')}`,
      }
}

function main(): void {
  process.stdout.write(`claims:verify: ${CLAIMS.length} claims\n`)
  let failed = 0
  let deferred = 0
  let stale = 0
  for (const claim of CLAIMS) {
    const checks: [string, Result][] = [
      ['taxonomy', checkTaxonomy(claim)],
      ['evidence', checkEvidence(claim)],
      ['wired', checkWired(claim)],
      ['teeth', checkTeeth(claim)],
    ]
    const bad = checks.filter(([, r]) => !r.ok)
    const warns = checks.filter(([, r]) => r.ok && r.warn)
    const deferrals = checks.filter(([, r]) => r.ok && r.deferred)
    if (bad.length === 0) {
      // DEFERRED is a first-class outcome, NOT a pass: the claim is well-formed and wired, but its
      // falsifier could not run here (live tier, no cluster). Surface it distinctly so a green run
      // never silently hides teeth that were never exercised.
      if (deferrals.length > 0) deferred += 1
      // STALE evidence (runner valid but absent from this summary.json snapshot) is NOT "resolves
      // live" — tally it so the green headline cannot claim live evidence it does not have.
      if (warns.length > 0) stale += 1
      const mark = deferrals.length > 0 ? '⏸' : '✓'
      const teeth = deferrals.length > 0 ? 'teeth DEFERRED' : 'teeth'
      const note = warns.length > 0 ? ` (${warns.map(([n]) => `${n}: stale`).join(', ')})` : ''
      process.stdout.write(
        `  ${mark} ${claim.id}: schema, taxonomy, evidence, wired, ${teeth}${note}\n`,
      )
      for (const [name, r] of warns) process.stdout.write(`      ⚠ ${name}: ${r.detail}\n`)
      for (const [name, r] of deferrals) process.stdout.write(`      ⏸ ${name}: ${r.detail}\n`)
    } else {
      failed += 1
      process.stdout.write(`  ✗ ${claim.id}\n`)
      for (const [name, r] of bad) process.stdout.write(`      ${name}: ${r.detail}\n`)
    }
  }
  // The front-door projections moved off the README (now a thin pointer to the hosted site) into
  // their thematic docs homes; the byte gate is identical, only the file each block lives in moved.
  const blocks: [string, Result][] = [
    [
      'ARCHITECTURE.md claims',
      checkBlock('ARCHITECTURE.md', 'claims', README_START, README_END, renderReadmeBlock),
    ],
    [
      'ARCHITECTURE.md stats',
      checkBlock('ARCHITECTURE.md', 'stats', STATS_START, STATS_END, renderStatsBlock),
    ],
    [
      'ARCHITECTURE.md cost',
      checkBlock('ARCHITECTURE.md', 'cost', COST_START, COST_END, renderCostBlock),
    ],
    [
      'ARCHITECTURE.md boundaries',
      checkBlock(
        'ARCHITECTURE.md',
        'boundaries',
        BOUNDARIES_START,
        BOUNDARIES_END,
        renderBoundariesBlock,
      ),
    ],
    ['claims page', checkClaimsPage()],
    ['AGENTS.md commands census', checkCommandsCensus()],
  ]
  for (const [name, r] of blocks) {
    if (r.ok) {
      process.stdout.write(`  ✓ ${name}: ${r.detail}\n`)
    } else {
      failed += 1
      process.stdout.write(`  ✗ ${name}\n      drift: ${r.detail}\n`)
    }
  }

  // Surface the DEFERRED tally on BOTH paths — it is a first-class census outcome, not a footnote on
  // the green line, so an unrelated failure never hides "N live-tier claims were never falsified here".
  process.stdout.write(
    `\nclaims:verify: ${deferred} deferred (live-tier teeth pending a reachable cluster${deferred > 0 ? ' — re-run on the cluster to falsify' : ''})\n`,
  )
  if (stale > 0) {
    process.stdout.write(
      `claims:verify: ${stale} evidence STALE (runner valid but absent from this summary.json — regenerate with a full run; CI's fresh summary resolves them)\n`,
    )
  }

  if (failed > 0) {
    process.stderr.write(
      `\nclaims:verify FAILED: ${failed} check(s) failed (unfalsifiable claim or stale projection)\n`,
    )
    process.exit(1)
  }
  // Honest headline: every claim is well-formed, wired, and FALSIFIABLE on demand (the teeth ran).
  // It does NOT assert the evidence resolves live — `stale` of them point at a runner absent from
  // this snapshot, and `deferred` had their teeth deferred to a reachable cluster.
  process.stdout.write(
    `\nclaims:verify ✓: every claim is well-formed, wired, and falsifiable on demand` +
      ` (${deferred} deferred${stale > 0 ? `, ${stale} evidence STALE — regenerate summary.json` : ''})\n`,
  )
}

main()
