import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BOUNDARY_REGISTRY } from './lib/manifests/boundary-registry'
import { CLAIMS } from './lib/manifests/claims'
import { BOUNDARIES_END, BOUNDARIES_START } from './render-boundaries'
import { README_END, README_START } from './render-claims'
import { COST_END, COST_START } from './render-cost'
import { adrCount, countWorkspace, STATS_END, STATS_START } from './render-stats'

/**
 * `pnpm census`: the orphan + reverse-drift gate (sibling of chaos:verify / tour:verify). Phase 1
 * surfaced two rot classes this pins shut, both pure-filesystem so it runs in the always-on verify
 * lane — no cluster, no network:
 *
 *   (b1) ORPHAN   every scripts/*-results.ts fold-script and every *:verify npm gate must be RUN by
 *                 .github/workflows/ci.yml OR scripts/lib/gauntlet-plan.ts — by its npm name or the
 *                 underlying scripts/<file> it shells out to. A fold-script wired into nothing never
 *                 lands its runner in summary.json (the evidence is silently absent); a :verify gate
 *                 wired into nothing is dead code that looks alive. Allowlist a genuinely manual
 *                 subject by id WITH a reason; the gate prints the reason so it is never silent.
 *   (b2) MISSING  every `scripts/<name>` cited in a front-door doc (root AGENTS.md,
 *                 ARCHITECTURE.md, docs/adr/*.md) must exist on disk. This is the reverse
 *                 of the stale-reference class: scripts/spin-up-ephemeral.sh was cited for twelve
 *                 milestones before the file existed.
 *   (b3) ID DRIFT every well-known community-id literal hard-copied into a live shell script
 *                 (scripts/*.sh) must equal a canonical CommunityId declared in packages/contracts
 *                 — COMM_GENERAL (src/ids.ts) or EXAMPLE_COMMUNITY_ID (src/examples.ts). The live
 *                 rollout/seed/tour scripts paste these ids by hand (a generated env fragment was
 *                 rejected as over-built); this grep pins each copy to its source, so changing the
 *                 contract constant can no longer silently desync the shell harness.
 *   (b4) ONE-LOC  the one-location invariant (T25 / ADR-0038): a tracked count (services, packages,
 *                 ADRs, boundaries, falsifiable claims) has exactly ONE editable home — the stats
 *                 block (scripts/render-stats.ts, byte-gated by claims:verify) and the manifests it
 *                 derives from. Any DEFINITE restatement of that number in a second front-door doc
 *                 (a hand-typed "All 23 ADRs", "13 boundaries") that disagrees with the derived
 *                 source is RED — the same number hand-editable in two files is the drift class this
 *                 closes. Hedged forms ("~12 boundaries", "about 24") are prose, not a second home,
 *                 and are skipped; the byte-gated render blocks (stats/claims/boundaries/cost) are
 *                 their canonical home, so they are skipped too. Counts derive from the SAME helpers
 *                 the stats block uses (countWorkspace/adrCount + the manifests), so this gate and the
 *                 stats line can never disagree on how a count is computed.
 *
 * Exits non-zero on any violation, naming the file + the offending name.
 */

const ROOT = process.cwd()

interface AllowEntry {
  readonly name: string
  readonly reason: string
}

// (b1) escape hatch: a fold-script or :verify gate invoked only by hand (not CI, not the gauntlet
// plan). Add { name, reason } ONLY with a stated justification; an allowlisted orphan is reported
// (with its reason), never suppressed.
const ALLOWLIST: readonly AllowEntry[] = [
  {
    name: 'moderator:verify',
    reason:
      'CrossHair symbolic gate (ADR-0024 Phase 2) — deliberately off the blocking lane: needs uv + the ' +
      'crosshair-tool dev dep + a per-condition time budget. Run by hand or wire into a future ' +
      'moderator CI lane.',
  },
]

const CI_PATH = '.github/workflows/ci.yml'
const PLAN_PATH = 'scripts/lib/gauntlet-plan.ts'
const PKG_PATH = 'package.json'

// (b3) the canonical CommunityId literals live in these two contract modules; a community-id is
// `comm_` + 26 Crockford-base32 chars (the ULID alphabet, ids.ts). Any such literal pasted into a
// shell script must be one the contracts actually declare.
const CONTRACT_ID_SOURCES = ['packages/contracts/src/ids.ts', 'packages/contracts/src/examples.ts']
const COMMUNITY_ID_LITERAL = /comm_[0-9A-HJKMNP-TV-Z]{26}/g

// A `scripts/<name>` reference in prose. Anchored on a known extension + a word boundary so the bare
// `scripts/` directory and partial paths (e.g. `scripts/foo.tsx` against an .ts subject) don't match.
const SCRIPT_REF = /scripts\/[A-Za-z0-9._/-]+\.(?:ts|sh|js|mjs|py)\b/g
// The same shape, capturing just the basename, to pull a :verify gate's underlying file(s).
const SCRIPT_IN_CMD = /scripts\/([A-Za-z0-9._/-]+\.(?:ts|sh|js|mjs|py))/g

function read(path: string): string {
  const full = resolve(ROOT, path)
  return existsSync(full) ? readFileSync(full, 'utf8') : ''
}

interface Subject {
  readonly id: string
  // Any one of these appearing in the wiring text means the subject is run.
  readonly handles: readonly string[]
}

interface OrphanResult {
  readonly ok: boolean
  readonly allowed?: string
  readonly failure?: string
}

/** Build the orphan subjects: every fold-script file + every *:verify npm gate. */
function orphanSubjects(scripts: Record<string, string>): Subject[] {
  const scriptsDir = resolve(ROOT, 'scripts')
  const resultsFiles = existsSync(scriptsDir)
    ? readdirSync(scriptsDir).filter((f) => /-results\.ts$/.test(f))
    : []

  const fromFolds: Subject[] = resultsFiles.map((file) => {
    const invokers = Object.entries(scripts)
      .filter(([, cmd]) => cmd.includes(`scripts/${file}`))
      .map(([name]) => name)
    return { id: file, handles: [file, ...invokers] }
  })

  const fromVerify: Subject[] = Object.keys(scripts)
    .filter((name) => name.endsWith(':verify'))
    .map((name) => {
      const cmd = scripts[name] ?? ''
      const files = [...cmd.matchAll(SCRIPT_IN_CMD)]
        .map((m) => m[1])
        .filter((b): b is string => b !== undefined)
      return { id: name, handles: [name, ...files] }
    })

  return [...fromFolds, ...fromVerify]
}

function classifyOrphan(subject: Subject, wiring: string): OrphanResult {
  if (subject.handles.some((h) => wiring.includes(h))) return { ok: true }
  const entry = ALLOWLIST.find((a) => a.name === subject.id)
  if (entry) return { ok: true, allowed: `${subject.id}: orphan, allowlisted — ${entry.reason}` }
  return {
    ok: false,
    failure: `ORPHAN: ${subject.id} is run by neither ${CI_PATH} nor ${PLAN_PATH} (wire it into a lane, or add it to the census ALLOWLIST with a reason)`,
  }
}

/** (b2): every `scripts/<name>` cited in a front-door doc must exist on disk. */
function missingFailures(): string[] {
  const adrDir = resolve(ROOT, 'docs/adr')
  const adrFiles = existsSync(adrDir)
    ? readdirSync(adrDir)
        .filter((f) => /\.md$/.test(f))
        .map((f) => `docs/adr/${f}`)
    : []
  const sources = ['AGENTS.md', 'ARCHITECTURE.md', ...adrFiles]

  return sources.flatMap((src) => {
    const tokens = [...new Set(read(src).match(SCRIPT_REF) ?? [])]
    return tokens
      .filter((token) => !existsSync(resolve(ROOT, token)))
      .map((token) => `MISSING: ${src} cites ${token}, which does not exist on disk`)
  })
}

/** (b3): every `comm_<ulid>` literal in a live shell script must match a canonical contract id. */
function idDriftFailures(): string[] {
  const canonical = new Set(
    CONTRACT_ID_SOURCES.flatMap((src) => read(src).match(COMMUNITY_ID_LITERAL) ?? []),
  )
  if (canonical.size === 0) {
    return [
      'ID DRIFT: no canonical CommunityId literal found in packages/contracts (ids.ts/examples.ts) — census cannot anchor the shell-script id check',
    ]
  }
  const scriptsDir = resolve(ROOT, 'scripts')
  const shellScripts = existsSync(scriptsDir)
    ? readdirSync(scriptsDir).filter((f) => f.endsWith('.sh'))
    : []

  return shellScripts.flatMap((file) => {
    const literals = [...new Set(read(`scripts/${file}`).match(COMMUNITY_ID_LITERAL) ?? [])]
    return literals
      .filter((lit) => !canonical.has(lit))
      .map(
        (lit) =>
          `ID DRIFT: scripts/${file} hard-codes ${lit}, which is not a canonical CommunityId in packages/contracts (COMM_GENERAL/EXAMPLE_COMMUNITY_ID)`,
      )
  })
}

// (b4) the front-door docs whose CURRENT tracked totals are authoritative. ADRs are NOT scanned (a
// Layer-1 narrative ADR is full of contextual + historical numbers — "the 17 commitments", "ten
// milestones" — that are not a second home for the live total); the landscape docs are.
export const ONE_LOCATION_DOCS = ['AGENTS.md', 'ARCHITECTURE.md', 'README.md'] as const

// The byte-gated render blocks: each tracked count's ONE editable home (gated by claims:verify). Lines
// inside any of these are skipped — restating the number there IS the canonical projection, not drift.
const BLOCK_MARKERS = [
  STATS_START,
  STATS_END,
  README_START,
  README_END,
  BOUNDARIES_START,
  BOUNDARIES_END,
  COST_START,
  COST_END,
] as const

// A DEFINITE restatement of a tracked count: `<n> <noun>`, the same five nouns the stats line derives.
// `claims` alone is excluded (a "4 claims" subset count is legitimate prose) — only "falsifiable claims"
// matches, the exact phrase the stats block uses.
const TRACKED_NOUN = /\b(\d+)\s+(falsifiable claims|services|packages|boundaries|ADRs?)\b/g
const NOUN_TO_KEY: Record<string, string> = {
  services: 'service',
  packages: 'package',
  adrs: 'ADR',
  adr: 'ADR',
  boundaries: 'boundary',
  'falsifiable claims': 'claim',
}
// A hedge token immediately before the number ("~12", "about 24", "over 30 boundaries") marks an
// APPROXIMATION — prose, not a second editable home — so it is skipped. A bare count ("13 boundaries",
// "All 23 ADRs") is a definite restatement and is pinned to the derived source.
const HEDGE =
  /(?:~|≈|\babout|\baround|\broughly|\bnearly|\bover|\balmost|\bmore than|\bup to|\bat least)\s*$/i

/** The counts a tracked restatement is pinned to, derived from the SAME source as the stats block. */
export function trackedCounts(): Readonly<Record<string, number>> {
  return {
    service: countWorkspace('services').count,
    package: countWorkspace('packages').count,
    ADR: adrCount(),
    boundary: BOUNDARY_REGISTRY.length,
    claim: CLAIMS.length,
  }
}

/**
 * (b4) Pure core: every DEFINITE restatement of a tracked count in a front-door doc that disagrees
 * with the derived source. Lines inside a byte-gated render block (the count's one home) and hedged
 * approximations are skipped. Exported so census.test.ts can drive it with fixtures (the drift-failure
 * test): an out-of-band edit of a tracked number reds the gate; the in-band repo stays green.
 */
export function oneLocationFailures(
  docs: readonly { readonly path: string; readonly text: string }[],
  derived: Readonly<Record<string, number>>,
): string[] {
  const failures: string[] = []
  for (const { path, text } of docs) {
    let inBlock = false
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      if (BLOCK_MARKERS.some((m) => line.includes(m))) {
        inBlock = !inBlock
        continue
      }
      if (inBlock) continue
      for (const match of line.matchAll(TRACKED_NOUN)) {
        const before = line.slice(0, match.index)
        if (HEDGE.test(before)) continue
        const n = Number(match[1])
        const key = NOUN_TO_KEY[(match[2] ?? '').toLowerCase()]
        if (key === undefined) continue
        const expected = derived[key]
        if (expected !== undefined && n !== expected) {
          failures.push(
            `ONE-LOCATION: ${path}:${i + 1} restates "${match[0]}" but the derived ${key} count is ${expected} — a tracked count has ONE home (the stats block / manifest). Align the prose to ${expected}, hedge it (~${expected}), or drop the count.`,
          )
        }
      }
    }
  }
  return failures
}

function oneLocationDriftFailures(): string[] {
  const docs = ONE_LOCATION_DOCS.filter((p) => existsSync(resolve(ROOT, p))).map((p) => ({
    path: p,
    text: read(p),
  }))
  return oneLocationFailures(docs, trackedCounts())
}

function main(): void {
  const failures: string[] = []
  const notes: string[] = []

  if (!existsSync(resolve(ROOT, CI_PATH))) failures.push(`census cannot read ${CI_PATH}`)
  if (!existsSync(resolve(ROOT, PLAN_PATH))) failures.push(`census cannot read ${PLAN_PATH}`)

  const wiring = `${read(CI_PATH)}\n${read(PLAN_PATH)}`
  const pkg = JSON.parse(read(PKG_PATH)) as { scripts?: Record<string, string> }
  const subjects = orphanSubjects(pkg.scripts ?? {})

  for (const subject of subjects) {
    const result = classifyOrphan(subject, wiring)
    if (result.failure) failures.push(result.failure)
    if (result.allowed) notes.push(result.allowed)
  }

  const missing = missingFailures()
  for (const m of missing) failures.push(m)

  const idDrift = idDriftFailures()
  for (const d of idDrift) failures.push(d)

  const oneLoc = oneLocationDriftFailures()
  for (const o of oneLoc) failures.push(o)

  process.stdout.write(
    `census: ${subjects.length} fold/verify subject(s), ${missing.length} missing doc-cited script(s), ${idDrift.length} shell-script id-drift(s), ${oneLoc.length} one-location count-drift(s)\n`,
  )
  for (const note of notes) process.stdout.write(`  ⓘ ${note}\n`)

  if (failures.length > 0) {
    for (const f of failures) process.stderr.write(`  ✗ ${f}\n`)
    process.stderr.write(
      `\ncensus FAILED: ${failures.length} violation(s); wire the orphan into a lane, add the missing script, align the shell-script id, or fix the one-location count drift\n`,
    )
    process.exit(1)
  }
  process.stdout.write(
    'census ✓: every fold/verify subject is wired, every doc-cited script exists, every shell-script community-id matches a canonical contract id, and every tracked count has one home\n',
  )
}

// Only run when invoked directly, not when imported by census.test.ts (the b4 drift-failure test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
