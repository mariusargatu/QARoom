import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
 *                 docs/02-architecture.md, docs/adr/*.md) must exist on disk. This is the reverse
 *                 of the stale-reference class: scripts/spin-up-ephemeral.sh was cited for twelve
 *                 milestones before the file existed.
 *   (b3) ID DRIFT every well-known community-id literal hard-copied into a live shell script
 *                 (scripts/*.sh) must equal a canonical CommunityId declared in packages/contracts
 *                 — COMM_GENERAL (src/ids.ts) or EXAMPLE_COMMUNITY_ID (src/examples.ts). The live
 *                 rollout/seed/tour scripts paste these ids by hand (a generated env fragment was
 *                 rejected as over-built); this grep pins each copy to its source, so changing the
 *                 contract constant can no longer silently desync the shell harness.
 *
 * Exits non-zero on any violation, naming the file + the offending name.
 */

const ROOT = process.cwd()

interface AllowEntry {
  readonly name: string
  readonly reason: string
}

// (b1) escape hatch: a fold-script or :verify gate invoked only by hand (not CI, not the gauntlet
// plan). Empty today — every subject is wired into a lane. Add { name, reason } ONLY with a stated
// justification; an allowlisted orphan is reported (with its reason), never suppressed.
const ALLOWLIST: readonly AllowEntry[] = []

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
  const sources = ['AGENTS.md', 'docs/02-architecture.md', ...adrFiles]

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

  process.stdout.write(
    `census: ${subjects.length} fold/verify subject(s), ${missing.length} missing doc-cited script(s), ${idDrift.length} shell-script id-drift(s)\n`,
  )
  for (const note of notes) process.stdout.write(`  ⓘ ${note}\n`)

  if (failures.length > 0) {
    for (const f of failures) process.stderr.write(`  ✗ ${f}\n`)
    process.stderr.write(
      `\ncensus FAILED: ${failures.length} violation(s); wire the orphan into a lane, add the missing script, or align the shell-script id\n`,
    )
    process.exit(1)
  }
  process.stdout.write(
    'census ✓: every fold/verify subject is wired, every doc-cited script exists, and every shell-script community-id matches a canonical contract id\n',
  )
}

main()
