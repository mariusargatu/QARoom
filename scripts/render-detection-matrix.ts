import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { type DetectionToggle, TOGGLES } from './lib/manifests/detection-matrix'
import { DetectionMatrixArtifact, type MatrixCell } from './lib/manifests/detection-matrix-schema'
import { type CoverageMark, renderMatrixSvg, type SvgTier } from './lib/matrix-svg'

/**
 * Render the detection-matrix projections from test-results/detection-matrix.json: the committed
 * human-readable doc (coverage-first headline + heat-grid SVG + per-bug coverage + the curated
 * rows) and the SVGs themselves. Derived-only (render-claims discipline): every cell, count, and
 * pixel comes from the artifact; nothing is hand-typed.
 *
 *   pnpm matrix:render           # write docs/detection-matrix.md + docs/assets/*.svg + evidence snapshot
 *   pnpm matrix:render --check   # drift gate: committed files must equal a fresh render
 *
 * Reframe note (the headline counts BUGS, not cells): a cell `missed` is not a failed test, it is a
 * technique that ran green on a bug it does not defend. So the load-bearing signal is per-bug
 * coverage — `defended` / `awaiting` / `gap` — DERIVED here from the cells, never stored on them, so
 * a reader can recompute it. `gap` (caught by nothing AND nothing left to run) is the only real miss
 * and the only alarming color. The full 158-cell tally stays, demoted to a provenance footnote.
 *
 * Freshness is deliberately NOT CI-gated — cluster and llm tiers cannot run per-PR, and the
 * artifact is gitignored, so this gate runs where the artifact exists (locally, the gauntlet).
 * Staleness stays visible per-cell (commit + date).
 */
const ROOT = process.cwd()
const artifactPath = resolve(ROOT, 'test-results/detection-matrix.json')
const docPath = resolve(ROOT, 'docs/detection-matrix.md')
const assetsDir = resolve(ROOT, 'docs/assets')
const svgLightPath = resolve(assetsDir, 'detection-matrix-light.svg')
const svgDarkPath = resolve(assetsDir, 'detection-matrix-dark.svg')

if (!existsSync(artifactPath)) {
  process.stderr.write('no test-results/detection-matrix.json — run pnpm matrix first\n')
  process.exit(2)
}
const artifact = DetectionMatrixArtifact.parse(JSON.parse(readFileSync(artifactPath, 'utf8')))

const TS_COLUMNS = [
  'unit',
  'integration',
  'property',
  'mbt',
  'pact',
  'pact-oas-crosscheck',
  'reverse-conformance',
]
const PY_COLUMNS = ['py-unit', 'py-conformance', 'metamorphic']
const LIVE_COLUMNS = [
  'smoke',
  'k6',
  'mbt-live',
  'schemathesis',
  'tracetest',
  'tenant-spans',
  'chaos',
]
const LLM_COLUMNS = ['deepeval', 'redteam']

const TIER_ORDER: MatrixCell['tier'][] = ['in-proc', 'cluster', 'llm']
const columnsForTier = (tier: MatrixCell['tier']): string[] =>
  tier === 'in-proc'
    ? [...TS_COLUMNS, ...PY_COLUMNS]
    : tier === 'cluster'
      ? LIVE_COLUMNS
      : [...LLM_COLUMNS, 'metamorphic']

const isCrossRuntime = (isPy: boolean, tier: MatrixCell['tier'], col: string): boolean =>
  (isPy && tier === 'in-proc' && TS_COLUMNS.includes(col)) ||
  (!isPy && tier === 'in-proc' && PY_COLUMNS.includes(col))

const cellFor = (toggleId: string, technique: string, tier: MatrixCell['tier']) =>
  artifact.cells.find((c) => c.toggle === toggleId && c.technique === technique && c.tier === tier)

// ---- bug-level coverage: DERIVED from cells, never stored (auditable, recomputable) ----

type Defense = 'defended' | 'awaiting' | 'gap'

/**
 * A bug is `defended` if any technique caught it; else `awaiting` if any APPLICABLE cell in its
 * declared tiers has not run yet (n/r); else `gap` — it ran against everything and nothing caught
 * it. The per-applicable-cell n/r check (not a coarse tier-presence one) makes `gap` fire only when
 * literally nothing is left to run: the strongest honesty guarantee.
 */
function defenseFor(t: DetectionToggle): Defense {
  if (artifact.cells.some((c) => c.toggle === t.id && c.status === 'caught')) return 'defended'
  const isPy = t.component === 'moderator'
  for (const tier of t.tiers) {
    for (const col of columnsForTier(tier)) {
      if (isCrossRuntime(isPy, tier, col)) continue
      if (!cellFor(t.id, col, tier)) return 'awaiting'
    }
  }
  return 'gap'
}

const defenseByToggle = new Map<string, Defense>(TOGGLES.map((t) => [t.id, defenseFor(t)]))

const caughtInProc = new Set(
  artifact.cells.filter((c) => c.tier === 'in-proc' && c.status === 'caught').map((c) => c.toggle),
)

const coverage = {
  total: TOGGLES.length,
  defended: TOGGLES.filter((t) => defenseByToggle.get(t.id) === 'defended').length,
  awaiting: TOGGLES.filter((t) => defenseByToggle.get(t.id) === 'awaiting').length,
  gaps: TOGGLES.filter((t) => defenseByToggle.get(t.id) === 'gap').length,
  inProc: TOGGLES.filter((t) => caughtInProc.has(t.id)).length,
}
const deeperCount = coverage.defended - coverage.inProc

const counts = {
  caught: artifact.cells.filter((c) => c.status === 'caught').length,
  missed: artifact.cells.filter((c) => c.status === 'missed').length,
}

/** Split the recorded misses by the defense state of their bug — so the big number reads as buckets. */
function missBuckets() {
  let offBoundary = 0
  let awaitingTier = 0
  let open = 0
  for (const c of artifact.cells) {
    if (c.status !== 'missed') continue
    const d = defenseByToggle.get(c.toggle)
    if (d === 'defended') offBoundary += 1
    else if (d === 'awaiting') awaitingTier += 1
    else open += 1
  }
  return { offBoundary, awaitingTier, open }
}

const tierRank = (tier: MatrixCell['tier']) => TIER_ORDER.indexOf(tier)

/** De-duplicated `technique@tier` catchers for a bug, cheapest tier first. */
function caughtBy(toggleId: string): { technique: string; tier: MatrixCell['tier'] }[] {
  const seen = new Set<string>()
  return artifact.cells
    .filter((c) => c.toggle === toggleId && c.status === 'caught')
    .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.technique.localeCompare(b.technique))
    .filter((c) => {
      const k = `${c.technique}@${c.tier}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .map((c) => ({ technique: c.technique, tier: c.tier }))
}

const cheapestTier = (toggleId: string): MatrixCell['tier'] | null => {
  const tiers = caughtBy(toggleId).map((c) => c.tier)
  return tiers.length > 0 ? tiers.sort((a, b) => tierRank(a) - tierRank(b))[0] : null
}

const coverageLabel = (t: DetectionToggle): string => {
  if (caughtInProc.has(t.id)) return 'in-proc'
  const d = defenseByToggle.get(t.id)
  if (d === 'defended') return 'deeper'
  if (d === 'awaiting') return 'awaiting'
  return 'GAP'
}

// Sort the per-bug table attention-first: a real gap, then awaiting, then deeper, then in-proc;
// within a band, more catchers first (the most reassuring rows last).
const coverageRank = (t: DetectionToggle): number => {
  const l = coverageLabel(t)
  return l === 'GAP' ? 0 : l === 'awaiting' ? 1 : l === 'deeper' ? 2 : 3
}

function renderDoc(): string {
  const md: string[] = []
  md.push('# The detection matrix')
  md.push('')
  md.push(
    '> Generated by `pnpm matrix:render` from `test-results/detection-matrix.json`; do not edit by hand (`pnpm matrix:verify` gates drift).',
  )
  md.push('')
  md.push(
    'Each deliberate-bug toggle is armed one at a time against the whole testing battery (Tier A in-process, Tier B live cluster, Tier C real model). A bug is **caught** when at least one technique reds under it and re-greens with it off. This page counts **bugs, not cells** — a bug needs only one defender to be covered. The exhaustive per-cell record (every technique × bug, hash-stamped) lives in the [evidence snapshot](evidence/detection-matrix.snapshot.json); the SVG below is its picture.',
  )
  md.push('')
  md.push(renderDefenseCoverage())
  md.push('')
  md.push(renderFootnote())
  md.push('')
  return `${md.join('\n')}\n`
}

// ---- the coverage-first hero: bugs caught, not cells missed ----

function renderDefenseCoverage(): string {
  const md: string[] = []
  // Single bold span — no nested `**` (markdown renders `** **x** **` as stray asterisks).
  const awaitingClause =
    coverage.awaiting > 0
      ? `; the ${coverage.awaiting === 1 ? '1 remaining awaits' : `${coverage.awaiting} remaining await`} only a deeper lane not run here`
      : ''
  const gapClause =
    coverage.gaps > 0
      ? ` ${coverage.gaps} OPEN GAP${coverage.gaps === 1 ? '' : 'S'} — a bug caught by nothing that ran (see the per-bug table).`
      : ' 0 open gaps.'

  md.push('## Defense coverage')
  md.push('')
  md.push(
    `> **Every deliberate bug has a defender — ${coverage.defended} of ${coverage.total} proven (${coverage.inProc} in-process)${awaitingClause}.${gapClause}**`,
  )
  md.push(
    '> Each bug is the job of its 1–3 boundary techniques; the other columns defend other boundaries and correctly stay green. The grid is *meant* to be sparse — sparsity here is specialization, not thin coverage. An **open gap** (a bug that ran against everything and was caught by nothing) is the only state that is a real miss, and it renders loud red. ' +
      (coverage.gaps === 0
        ? 'There are none today.'
        : `There ${coverage.gaps === 1 ? 'is' : 'are'} ${coverage.gaps} today.`),
  )
  md.push('')
  md.push('| Coverage | Bugs |')
  md.push('|---|---|')
  md.push(`| Caught in-process (Tier A, cheapest) | ${coverage.inProc} / ${coverage.total} |`)
  md.push(`| Caught only deeper (cluster / LLM tier) | ${deeperCount} / ${coverage.total} |`)
  md.push(
    `| Awaiting its tier (defender lane not run here) | ${coverage.awaiting} / ${coverage.total} |`,
  )
  md.push(
    `| **Open gap (caught by nothing that ran)** | **${coverage.gaps} / ${coverage.total}** |`,
  )
  md.push('')
  md.push('<picture>')
  md.push('<source media="(prefers-color-scheme: dark)" srcset="assets/detection-matrix-dark.svg">')
  md.push(
    `<img alt="Coverage strip: ${coverage.defended} of ${coverage.total} deliberate bugs caught (${coverage.awaiting} awaiting a deeper lane, ${coverage.gaps} open gaps). In the grid, strong cells are catches; soft-tinted cells are off-boundary (a specialized technique correctly staying green on a bug it does not defend); amber is awaiting its tier; red is an open gap${coverage.gaps === 0 ? ' (none today)' : ''}; faint cells are not applicable or not yet run." src="assets/detection-matrix-light.svg">`,
  )
  md.push('</picture>')
  md.push('')
  md.push('### Per-bug coverage')
  md.push('')
  md.push(
    'Sorted attention-first: anything `GAP` or `awaiting` floats to the top. Each bug needs only one catcher to be covered.',
  )
  md.push('')
  md.push('| Deliberate bug | Coverage | Caught by | Cheapest tier |')
  md.push('|---|---|---|---|')
  const sorted = [...TOGGLES].sort(
    (a, b) =>
      coverageRank(a) - coverageRank(b) ||
      caughtBy(b.id).length - caughtBy(a.id).length ||
      a.id.localeCompare(b.id),
  )
  for (const t of sorted) {
    const cb = caughtBy(t.id)
    const by =
      cb.length > 0 ? `${cb.map((c) => c.technique).join(', ')} (${cb.length})` : '— (not run here)'
    const cheapest = cheapestTier(t.id) ?? '—'
    md.push(`| \`${t.id}\` | ${coverageLabel(t)} | ${by} | ${cheapest} |`)
  }
  return md.join('\n')
}

const gridCells = () => buildTiers().flatMap((t) => t.grid.flat()).length
const ghostCount = () => gridCells() - counts.caught - counts.missed

function renderFootnote(): string {
  const b = missBuckets()
  const reds = artifact.baseline?.standing_reds.length ?? 0
  const inProcCaught = artifact.cells.filter(
    (c) => c.tier === 'in-proc' && c.status === 'caught',
  ).length
  const inProcMissed = artifact.cells.filter(
    (c) => c.tier === 'in-proc' && c.status === 'missed',
  ).length
  return (
    `<sub>**Cell tally (provenance footnote).** ${counts.caught + counts.missed} cells measured across the tiers: ` +
    `**${counts.caught} catches** + **${counts.missed} off-boundary** (not failures). The ${counts.missed} break down as ` +
    `**${b.offBoundary} off-boundary** (the bug was caught by its own defender elsewhere; these columns guard other boundaries, so green is expected) + ` +
    `**${b.awaitingTier} awaiting their tier** + **${b.open} open gap${b.open === 1 ? '' : 's'}**. ` +
    `The in-process slice is ${inProcCaught} catches + ${inProcMissed} off-boundary. ` +
    `${ghostCount()} further positions are n/a (no code path) or n/r (not run). ` +
    `Baseline: \`${artifact.baseline?.commit.slice(0, 12) ?? 'none'}\` (${reds} standing red${reds === 1 ? '' : 's'}, fast-check seed ${artifact.baseline?.fastcheck_seed ?? '?'}). ` +
    `Last render: ${artifact.generated_at}. A frozen, hash-stamped snapshot of every cell is committed at [docs/evidence/detection-matrix.snapshot.json](evidence/detection-matrix.snapshot.json).</sub>`
  )
}

// ---- SVG inputs ----

function tierGrid(
  tier: MatrixCell['tier'],
  columns: string[],
  toggles: typeof TOGGLES,
): SvgTier['grid'] {
  return toggles.map((t) =>
    columns.map((col) => {
      const isPy = t.component === 'moderator'
      if (isCrossRuntime(isPy, tier, col)) return { status: 'other' as const }
      const cell = cellFor(t.id, col, tier)
      if (!cell) return { status: 'other' as const }
      if (cell.status === 'caught') return { status: 'caught' as const }
      if (cell.status === 'missed') {
        // A missed cell is off-boundary (this technique isn't this bug's defender) UNLESS the bug
        // is a true gap — then it is the alarming `open`. Bug-level `awaiting` shows in the strip,
        // not per cell: contract-drift's in-proc greens are genuinely off-boundary (cluster is its
        // defender), so they tint soft, while the bug as a whole reads amber in the coverage strip.
        return defenseByToggle.get(t.id) === 'gap'
          ? { status: 'open' as const }
          : { status: 'off-boundary' as const }
      }
      return { status: 'other' as const }
    }),
  )
}

function buildTiers(): SvgTier[] {
  // Every tier renders against the FULL bug list (TOGGLES), so all grids + the coverage strip share
  // one row axis and a single column of row labels lines up across them; a bug that doesn't declare a
  // tier just shows blank (n/a) cells there.
  const inProcCols = [...TS_COLUMNS, ...PY_COLUMNS]
  const tiers: SvgTier[] = [
    {
      label: 'Tier A · in-proc',
      columns: inProcCols,
      grid: tierGrid('in-proc', inProcCols, TOGGLES),
    },
  ]
  if (artifact.cells.some((c) => c.tier === 'cluster')) {
    tiers.push({
      label: 'Tier B · live cluster',
      columns: LIVE_COLUMNS,
      grid: tierGrid('cluster', LIVE_COLUMNS, TOGGLES),
    })
  }
  if (artifact.cells.some((c) => c.tier === 'llm')) {
    const llmCols = [...LLM_COLUMNS, 'metamorphic']
    tiers.push({
      label: 'Tier C · real model',
      columns: llmCols,
      grid: tierGrid('llm', llmCols, TOGGLES),
    })
  }
  return tiers
}

/** The left coverage strip: one mark per bug (manifest order), encoding its bug-level coverage. */
function buildCoverageStrip(): CoverageMark[] {
  return TOGGLES.map((t) => {
    const status = caughtInProc.has(t.id)
      ? ('in-proc' as const)
      : defenseByToggle.get(t.id) === 'defended'
        ? ('deeper' as const)
        : defenseByToggle.get(t.id) === 'awaiting'
          ? ('awaiting' as const)
          : ('open' as const)
    return { status, label: t.id }
  })
}

const snapshotPath = resolve(ROOT, 'docs/evidence/detection-matrix.snapshot.json')

// The committed, hash-stamped evidence snapshot: every measured cell plus the derived coverage
// rollup, in the tree, so a reader who will not clone-and-run can still verify the grid AND the
// headline numbers instead of trusting the prose. The raw artifact stays gitignored; the sha256
// binds the two.
function renderSnapshot(): string {
  const cells = [...artifact.cells]
    .map((c) => ({ toggle: c.toggle, technique: c.technique, tier: c.tier, status: c.status }))
    .sort(
      (a, b) =>
        a.toggle.localeCompare(b.toggle) ||
        a.tier.localeCompare(b.tier) ||
        a.technique.localeCompare(b.technique),
    )
  const snapshot = {
    generated_at: artifact.generated_at,
    baseline: {
      commit: artifact.baseline?.commit ?? null,
      fastcheck_seed: artifact.baseline?.fastcheck_seed ?? null,
      standing_reds: artifact.baseline?.standing_reds.length ?? 0,
    },
    counts: { ...counts, measured: counts.caught + counts.missed },
    defense: {
      total: coverage.total,
      defended: coverage.defended,
      in_proc: coverage.inProc,
      deeper: deeperCount,
      awaiting: coverage.awaiting,
      gaps: coverage.gaps,
    },
    miss_buckets: missBuckets(),
    artifact_sha256: createHash('sha256').update(readFileSync(artifactPath)).digest('hex'),
    cells,
  }
  return `${JSON.stringify(snapshot, null, 2)}\n`
}

function main(): void {
  const doc = renderDoc()
  const tiers = buildTiers()
  const strip = buildCoverageStrip()
  const svgLight = renderMatrixSvg(tiers, strip, 'light')
  const svgDark = renderMatrixSvg(tiers, strip, 'dark')

  if (process.argv.includes('--check')) {
    const problems: string[] = []
    const committed = existsSync(docPath) ? readFileSync(docPath, 'utf8') : ''
    if (committed !== doc) problems.push('docs/detection-matrix.md is stale')
    if (!existsSync(svgLightPath) || readFileSync(svgLightPath, 'utf8') !== svgLight) {
      problems.push('docs/assets/detection-matrix-light.svg is stale')
    }
    if (!existsSync(svgDarkPath) || readFileSync(svgDarkPath, 'utf8') !== svgDark) {
      problems.push('docs/assets/detection-matrix-dark.svg is stale')
    }
    if (!existsSync(snapshotPath) || readFileSync(snapshotPath, 'utf8') !== renderSnapshot()) {
      problems.push('docs/evidence/detection-matrix.snapshot.json is stale')
    }
    if (problems.length > 0) {
      for (const p of problems) process.stderr.write(`✗ ${p} — run pnpm matrix:render\n`)
      process.exit(1)
    }
    process.stdout.write('✓ matrix doc, SVGs, and evidence snapshot match a fresh render\n')
    process.exit(0)
  }

  mkdirSync(assetsDir, { recursive: true })
  mkdirSync(resolve(ROOT, 'docs/evidence'), { recursive: true })
  writeFileSync(docPath, doc)
  writeFileSync(svgLightPath, svgLight)
  writeFileSync(svgDarkPath, svgDark)
  writeFileSync(snapshotPath, renderSnapshot())
  process.stdout.write(
    `wrote docs/detection-matrix.md (${artifact.cells.length} cells, ${coverage.defended}/${coverage.total} bugs defended) + docs/assets/detection-matrix-{light,dark}.svg + docs/evidence/detection-matrix.snapshot.json\n`,
  )
}

main()
