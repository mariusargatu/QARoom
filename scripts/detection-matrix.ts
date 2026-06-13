import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CLAIMS } from '@qaroom/contracts/claims'
import { type DetectionToggle, TOGGLES } from '@qaroom/contracts/detection-matrix'
import { DetectionMatrixArtifact, type MatrixCell } from '@qaroom/contracts/detection-matrix-schema'
import { CLUSTER_ROWS, runClusterRow } from './lib/matrix-cluster'
import {
  computeCells,
  type FileStatus,
  runPySweep,
  runTsSweep,
  type SweepResult,
} from './lib/matrix-run'

/**
 * THE DETECTION MATRIX — arm each deliberate-bug toggle, run the whole battery, record EVERY
 * technique's verdict. `pnpm prove <id> --break` proves the designated gate catches its bug;
 * the matrix measures what everything ELSE does: triangulation, single points of detection,
 * and proven blindness. Cells fold idempotently into test-results/detection-matrix.json.
 *
 *   pnpm matrix                      # plan + current cell status
 *   pnpm matrix --verify             # manifest census: every toggle's env is really read,
 *                                    # and the declared guard matches the read site
 *   pnpm matrix --baseline           # record standing reds (same commit/seed) before any tier
 *   pnpm matrix --tier in-proc       # Tier A: ~17 toggles × full in-proc battery (~90 min)
 *   pnpm matrix --tier in-proc --toggle webhook-no-cap
 */
const ROOT = process.cwd()
const ARTIFACT = resolve(ROOT, 'test-results/detection-matrix.json')
const args = process.argv.slice(2)
const flagValue = (name: string): string | undefined => {
  const idx = args.indexOf(name)
  return idx >= 0 ? args[idx + 1] : undefined
}

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()

function loadArtifact(): DetectionMatrixArtifact {
  if (!existsSync(ARTIFACT)) {
    return { schema_version: 1, generated_at: new Date().toISOString(), baseline: null, cells: [] }
  }
  return DetectionMatrixArtifact.parse(JSON.parse(readFileSync(ARTIFACT, 'utf8')))
}

function saveArtifact(artifact: DetectionMatrixArtifact): void {
  const parsed = DetectionMatrixArtifact.parse({
    ...artifact,
    generated_at: new Date().toISOString(),
  })
  writeFileSync(ARTIFACT, `${JSON.stringify(parsed, null, 2)}\n`)
}

const cellKey = (c: Pick<MatrixCell, 'toggle' | 'technique' | 'tier'>) =>
  `${c.toggle}|${c.technique}|${c.tier}`

function foldCells(artifact: DetectionMatrixArtifact, cells: MatrixCell[]): void {
  const replaced = new Set(cells.map(cellKey))
  artifact.cells = [...artifact.cells.filter((c) => !replaced.has(cellKey(c))), ...cells]
}

// ── --verify: the census — the manifest can never name a toggle nothing reads, and the
// declared guard must match what the read site actually does (cheap heuristic greps, same
// spirit as the env-name check): a node-env-gated read lives in a file that mentions NODE_ENV,
// an unguarded one must not, and settings-load is exactly the pydantic settings-load timing. ──
const guardViolation = (toggle: DetectionToggle, src: string): string | null => {
  if ((toggle.guard === 'settings-load') !== (toggle.readSite.timing === 'settings-load')) {
    return `guard "${toggle.guard}" contradicts readSite timing "${toggle.readSite.timing}"`
  }
  if (toggle.guard === 'node-env-gated' && !src.includes('NODE_ENV')) {
    return 'declared node-env-gated but the readSite never mentions NODE_ENV'
  }
  if (toggle.guard === 'unguarded' && src.includes('NODE_ENV')) {
    return 'declared unguarded but the readSite mentions NODE_ENV (gated read?)'
  }
  return null
}

if (args.includes('--verify')) {
  let bad = 0
  for (const toggle of TOGGLES) {
    const path = resolve(ROOT, toggle.readSite.file)
    if (!existsSync(path)) {
      process.stderr.write(`✗ ${toggle.id}: readSite missing — ${toggle.readSite.file}\n`)
      bad += 1
      continue
    }
    const src = readFileSync(path, 'utf8')
    // settings-load toggles are pydantic fields: MODERATOR_UNGROUNDED → moderator_ungrounded
    // (BaseSettings maps env names case-insensitively), so the census greps the field name.
    const needle =
      toggle.readSite.timing === 'settings-load' ? toggle.env.name.toLowerCase() : toggle.env.name
    if (!src.includes(needle)) {
      process.stderr.write(`✗ ${toggle.id}: ${toggle.readSite.file} never reads ${needle}\n`)
      bad += 1
    }
    const guardProblem = guardViolation(toggle, src)
    if (guardProblem !== null) {
      process.stderr.write(`✗ ${toggle.id}: ${guardProblem}\n`)
      bad += 1
    }
    if (toggle.claimId && !CLAIMS.some((c) => c.id === toggle.claimId)) {
      process.stderr.write(`✗ ${toggle.id}: claimId "${toggle.claimId}" not in claims.ts\n`)
      bad += 1
    }
  }
  for (const claim of CLAIMS) {
    if (!TOGGLES.some((t) => t.env.name === claim.toggle)) {
      process.stderr.write(`✗ claims.ts toggle ${claim.toggle} missing from the matrix manifest\n`)
      bad += 1
    }
  }
  process.stdout.write(
    bad === 0
      ? `✓ census clean — ${TOGGLES.length} toggles, every env read where (and how) the manifest says\n`
      : `${bad} census violation(s)\n`,
  )
  process.exit(bad === 0 ? 0 : 1)
}

// ── --baseline: standing reds on this commit/seed, the diff base for every verdict ──
if (args.includes('--baseline')) {
  process.stdout.write(`▶ baseline sweep (no toggle) @ ${commit.slice(0, 8)}\n  TS packages:\n`)
  const ts = runTsSweep(ROOT, {})
  process.stdout.write('  Python:\n')
  const py = runPySweep(ROOT, {})
  const standing = [...ts.files, ...py.files]
    .filter(([, status]) => status === 'failed')
    .map(([file]) => file)
    .sort()
  const artifact = loadArtifact()
  artifact.baseline = {
    commit,
    recorded_at: new Date().toISOString(),
    fastcheck_seed: 0xc0ffee,
    standing_reds: standing,
  }
  saveArtifact(artifact)
  process.stdout.write(
    `baseline recorded — ${ts.files.size + py.files.size} files, ${standing.length} standing red(s)${
      standing.length > 0 ? `:\n  ${standing.join('\n  ')}` : ''
    }\n`,
  )
  process.exit(0)
}

// ── --tier <t> [--toggle <id>]: run the battery under each armed toggle ──
const tier = flagValue('--tier')
if (tier === 'in-proc') {
  const onlyId = flagValue('--toggle')
  const artifact = loadArtifact()
  if (!artifact.baseline) {
    process.stderr.write('no baseline — run `pnpm matrix --baseline` first (same commit/seed)\n')
    process.exit(2)
  }
  if (artifact.baseline.commit !== commit) {
    process.stderr.write(
      `baseline commit ${artifact.baseline.commit.slice(0, 8)} ≠ HEAD ${commit.slice(0, 8)} — re-run --baseline\n`,
    )
    process.exit(2)
  }
  const standingReds = new Set(artifact.baseline.standing_reds)
  const targets = TOGGLES.filter(
    (t) => t.tiers.includes('in-proc') && (onlyId === undefined || t.id === onlyId),
  )
  if (onlyId && targets.length === 0) {
    process.stderr.write(`unknown or non-in-proc toggle "${onlyId}"\n`)
    process.exit(2)
  }
  for (const [i, toggle] of targets.entries()) {
    process.stdout.write(
      `\n▶ [${i + 1}/${targets.length}] ${toggle.id} — arming ${toggle.env.name}=${toggle.env.value}\n`,
    )
    const envPatch = { [toggle.env.name]: toggle.env.value }
    const sweep: SweepResult =
      toggle.component === 'moderator' ? runPySweep(ROOT, envPatch) : runTsSweep(ROOT, envPatch)
    const cells = computeCells({
      root: ROOT,
      toggle,
      tier: 'in-proc',
      sweep,
      standingReds,
      commit,
      recordedAt: new Date().toISOString(),
    })
    foldCells(artifact, cells)
    saveArtifact(artifact) // save per toggle — a 90-min run must survive interruption
    const caught = cells.filter((c) => c.status === 'caught')
    process.stdout.write(
      `  ${toggle.id}: ${caught.length > 0 ? `caught by ${caught.map((c) => c.technique).join(', ')}` : 'MISSED by every in-proc group'}\n`,
    )
  }
  process.exit(0)
}
// ── Tier B: live cluster rows (needs the gauntlet's cluster up + battery proven green) ──
if (tier === 'cluster') {
  const onlyId = flagValue('--toggle')
  const artifact = loadArtifact()
  const targets = TOGGLES.filter(
    (t) => t.tiers.includes('cluster') && (onlyId === undefined || t.id === onlyId),
  ).filter((t) => CLUSTER_ROWS[t.id])
  if (targets.length === 0) {
    process.stderr.write(`no cluster rows match${onlyId ? ` "${onlyId}"` : ''}\n`)
    process.exit(2)
  }
  for (const [i, toggle] of targets.entries()) {
    process.stdout.write(`\n▶ [${i + 1}/${targets.length}] ${toggle.id} (live)\n`)
    const cells = runClusterRow(ROOT, {
      toggleId: toggle.id,
      env: toggle.env,
      guard: toggle.guard,
      commit,
      recordedAt: new Date().toISOString(),
    })
    foldCells(artifact, cells)
    saveArtifact(artifact)
  }
  process.exit(0)
}

// ── Tier C: key-gated LLM eval rows (cost-guarded; clean diff base recorded once) ──
const LLM_GROUP_RUNS: { group: string; uvArgs: string[]; pytestArgs: string[] }[] = [
  { group: 'deepeval', uvArgs: ['run', '--group', 'eval'], pytestArgs: ['-q', 'evals/deepeval'] },
  {
    group: 'redteam',
    uvArgs: ['run', '--group', 'eval'],
    pytestArgs: ['-q', 'evals/redteam', '-m', 'deepteam'],
  },
  {
    group: 'metamorphic',
    uvArgs: ['run'],
    pytestArgs: ['-q', '-m', 'llm', 'tests/test_metamorphic.py'],
  },
]
const llmSweep = (envPatch: Record<string, string>): SweepResult => {
  const merged = new Map<string, FileStatus>()
  let duration = 0
  for (const g of LLM_GROUP_RUNS) {
    const s = runPySweep(ROOT, envPatch, g.pytestArgs, g.uvArgs)
    for (const [f, st] of s.files) merged.set(f, st)
    duration += s.duration_ms
  }
  return { files: merged, duration_ms: duration }
}

if (tier === 'llm') {
  if (!process.env.OPENAI_API_KEY) {
    process.stderr.write('OPENAI_API_KEY not set — the llm tier costs real spend, key required\n')
    process.exit(2)
  }
  const guard = spawnSync('uv', ['run', 'python', '-m', 'moderator_agent.eval_cost_guard'], {
    cwd: resolve(ROOT, 'services/moderator-agent'),
    stdio: 'inherit',
  })
  if (guard.status !== 0) {
    process.stderr.write('eval cost guard refused the run — budget first, evals second\n')
    process.exit(2)
  }
  const onlyId = flagValue('--toggle')
  const artifact = loadArtifact()
  if (!artifact.baseline) {
    process.stderr.write('no baseline — run `pnpm matrix --baseline` first\n')
    process.exit(2)
  }
  if (!artifact.baseline.llm_recorded_at) {
    process.stdout.write('▶ llm clean pass (diff base for eval verdicts — one-time spend)\n')
    const clean = llmSweep({})
    const reds = [...clean.files].filter(([, s]) => s === 'failed').map(([f]) => f)
    artifact.baseline.standing_reds = [
      ...new Set([...artifact.baseline.standing_reds, ...reds]),
    ].sort()
    artifact.baseline.llm_recorded_at = new Date().toISOString()
    saveArtifact(artifact)
    process.stdout.write(`  clean pass done — ${reds.length} standing red(s) merged\n`)
  }
  const standingReds = new Set(artifact.baseline.standing_reds)
  const targets = TOGGLES.filter(
    (t) => t.tiers.includes('llm') && (onlyId === undefined || t.id === onlyId),
  )
  for (const [i, toggle] of targets.entries()) {
    process.stdout.write(
      `\n▶ [${i + 1}/${targets.length}] ${toggle.id} — arming ${toggle.env.name}=${toggle.env.value} (llm)\n`,
    )
    const sweep = llmSweep({ [toggle.env.name]: toggle.env.value })
    const cells = computeCells({
      root: ROOT,
      toggle,
      tier: 'llm',
      sweep,
      standingReds,
      commit,
      recordedAt: new Date().toISOString(),
      groups: ['deepeval', 'redteam', 'metamorphic'],
    })
    foldCells(artifact, cells)
    saveArtifact(artifact)
    const caught = cells.filter((c) => c.status === 'caught')
    process.stdout.write(
      `  ${toggle.id}: ${caught.length > 0 ? `caught by ${caught.map((c) => c.technique).join(', ')}` : 'MISSED by every llm group'}\n`,
    )
  }
  process.exit(0)
}

if (tier !== undefined) {
  process.stderr.write(`unknown tier "${tier}" (in-proc | cluster | llm)\n`)
  process.exit(2)
}

// ── default: the plan ──
const artifact = loadArtifact()
const byKey = new Map(artifact.cells.map((c) => [cellKey(c), c]))
process.stdout.write(
  `\nDETECTION MATRIX — ${TOGGLES.length} toggles, baseline ${
    artifact.baseline
      ? `@ ${artifact.baseline.commit.slice(0, 8)} (${artifact.baseline.standing_reds.length} standing reds)`
      : 'NOT RECORDED'
  }\n\n`,
)
for (const toggle of TOGGLES) {
  const cells = artifact.cells.filter((c) => c.toggle === toggle.id)
  const caught = cells.filter((c) => c.status === 'caught').map((c) => `${c.technique}@${c.tier}`)
  const ran = cells.length
  process.stdout.write(
    `  ${toggle.id.padEnd(30)} ${toggle.env.name.padEnd(34)} tiers:${toggle.tiers.join(',').padEnd(16)} ${
      ran === 0 ? '· not run' : caught.length > 0 ? `✓ ${caught.join(', ')}` : '✗ all missed'
    }\n`,
  )
}
process.stdout.write(
  `\n${byKey.size} cells recorded. Next: pnpm matrix --baseline, then pnpm matrix --tier in-proc\n`,
)
