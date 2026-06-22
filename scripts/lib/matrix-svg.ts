/**
 * The README's one visual mark: the detection matrix as a compact heat-grid SVG, in the visual
 * grammar of GitHub's contribution graph (familiar = instantly legible as "dense evidence grid").
 * Derived entirely from the committed matrix render inputs; no clock, no randomness, so the same
 * artifact always yields byte-identical SVGs (`pnpm matrix:render --check` gates them).
 *
 * Reframed to read coverage-first (the design brief): a left COVERAGE STRIP shows each bug's
 * bug-level coverage (every bug should have a defender), and the grid is a relevance gradient, NOT
 * pass/fail — a catch is a strong fill, an off-boundary green is a soft tint that RECEDES (a
 * specialized technique correctly ignoring a bug it does not defend, not a hole), and the only
 * alarming color is `open` red (a bug caught by nothing that ran). With zero open gaps the image
 * contains no red, which itself reads as "nothing is exposed". The full per-cell truth lives in
 * docs/detection-matrix.md; this is the shape.
 */

export interface SvgCell {
  status: 'caught' | 'off-boundary' | 'open' | 'other'
}

export interface SvgTier {
  label: string
  /** rows x columns of cells, row-major; all rows the same length */
  grid: SvgCell[][]
}

/** One mark in the left coverage strip — a bug's bug-level coverage, not a single cell. */
export interface CoverageMark {
  status: 'in-proc' | 'deeper' | 'awaiting' | 'open'
}

const CELL = 12
const GAP = 3
const TIER_GAP = 14
const TOP = 22
const PAD = 2
const CHAR = 5.4 // ~px per character at font-size 10, for width/legend layout

interface Palette {
  caught: string
  offBoundary: string
  open: string
  other: string
  coverDeeper: string
  coverAwaiting: string
  label: string
}

// DESIGN.md slate (oklch 0.470 0.078 262) and its dark-surface counterpart, pre-converted to hex
// because GitHub serves these SVGs through <img>, where external CSS cannot reach. Off-boundary is
// a soft tint BETWEEN caught and ghost (recedes, not a hole); open is the sole alarming red.
const LIGHT: Palette = {
  caught: '#3f669a',
  offBoundary: '#dbe2ec',
  open: '#c0392b',
  other: '#eef0f4',
  coverDeeper: '#9db3d2',
  coverAwaiting: '#b08a4a',
  label: '#6b7280',
}
const DARK: Palette = {
  caught: '#8fb0dc',
  offBoundary: '#2c333d',
  open: '#e06c5b',
  other: '#1e2126',
  coverDeeper: '#5f7ba6',
  coverAwaiting: '#caa45f',
  label: '#9aa0aa',
}

const fillRect = (x: number, y: number, fill: string) =>
  `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${fill}"/>`

const gridCellSvg = (cell: SvgCell, x: number, y: number, p: Palette): string => {
  if (cell.status === 'caught') return fillRect(x, y, p.caught)
  if (cell.status === 'open') return fillRect(x, y, p.open)
  if (cell.status === 'off-boundary') return fillRect(x, y, p.offBoundary)
  return fillRect(x, y, p.other)
}

const coverColor = (mark: CoverageMark, p: Palette): string =>
  mark.status === 'in-proc'
    ? p.caught
    : mark.status === 'deeper'
      ? p.coverDeeper
      : mark.status === 'awaiting'
        ? p.coverAwaiting
        : p.open

export function renderMatrixSvg(
  tiers: SvgTier[],
  coverage: CoverageMark[],
  variant: 'light' | 'dark',
): string {
  const p = variant === 'light' ? LIGHT : DARK
  const maxRows = Math.max(coverage.length, ...tiers.map((t) => t.grid.length))
  const height = TOP + maxRows * (CELL + GAP) + PAD

  const groups: string[] = []
  let labelExtent = 0

  // Left coverage strip: one tall column, one cell per bug (manifest order).
  let x = PAD
  groups.push(
    `<text x="${x}" y="${TOP - 9}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="10" fill="${p.label}">coverage</text>`,
  )
  for (let r = 0; r < coverage.length; r++) {
    groups.push(fillRect(x, TOP + r * (CELL + GAP), coverColor(coverage[r], p)))
  }
  const stripLabelW = Math.ceil('coverage'.length * CHAR)
  labelExtent = Math.max(labelExtent, x + stripLabelW)
  // Advance past the wider of the 1-cell strip and its label, so "coverage" never collides with the
  // first tier's caption; the extra space doubles as a visual break between summary strip and grid.
  x += Math.max(CELL, stripLabelW) + TIER_GAP + GAP

  // Tier grids.
  for (const tier of tiers) {
    const cols = tier.grid[0]?.length ?? 0
    for (let r = 0; r < tier.grid.length; r++) {
      for (let c = 0; c < cols; c++) {
        groups.push(gridCellSvg(tier.grid[r][c], x + c * (CELL + GAP), TOP + r * (CELL + GAP), p))
      }
    }
    groups.push(
      `<text x="${x}" y="${TOP - 9}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="10" fill="${p.label}">${tier.label}</text>`,
    )
    labelExtent = Math.max(labelExtent, x + Math.ceil(tier.label.length * CHAR))
    x += cols * (CELL + GAP) - GAP + TIER_GAP + GAP
  }
  const gridWidth = x - TIER_GAP - GAP + PAD

  // Cell tallies (grid only — the strip is bug-level, summarized in the desc).
  const all = tiers.flatMap((t) => t.grid.flat())
  const caught = all.filter((c) => c.status === 'caught').length
  const offBoundary = all.filter((c) => c.status === 'off-boundary').length
  const open = all.filter((c) => c.status === 'open').length
  const ghosts = all.filter((c) => c.status === 'other').length

  // Coverage tallies (strip) for the desc.
  const cov = {
    inProc: coverage.filter((m) => m.status === 'in-proc').length,
    deeper: coverage.filter((m) => m.status === 'deeper').length,
    awaiting: coverage.filter((m) => m.status === 'awaiting').length,
    open: coverage.filter((m) => m.status === 'open').length,
  }
  const defended = cov.inProc + cov.deeper

  // Microlegend: four named grid states, laid out left-to-right with measured advances so long
  // labels never collide. `open gap (0)` is shown even at zero — the absence is the positive signal.
  const ly = height - 12
  let lx = PAD
  const legendParts: string[] = []
  const entry = (fill: string, text: string) => {
    legendParts.push(fillRect(lx, ly, fill))
    legendParts.push(
      `<text x="${lx + CELL + 5}" y="${ly + 9}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="10" fill="${p.label}">${text}</text>`,
    )
    lx += CELL + 5 + Math.ceil(text.length * CHAR) + 16
  }
  entry(p.caught, `caught (${caught})`)
  entry(p.offBoundary, `off-boundary, ran green (${offBoundary})`)
  entry(p.open, `open gap (${open})`)
  entry(p.other, `n/a or not run (${ghosts})`)
  const legendWidth = lx + PAD

  const width = Math.max(gridWidth, labelExtent + PAD, legendWidth)
  const fullHeight = height + 22

  const desc =
    `Coverage strip: ${defended} of ${coverage.length} deliberate bugs caught ` +
    `(${cov.awaiting} awaiting a deeper lane, ${cov.open} open gaps). In the grid, strong cells are ` +
    `catches; soft-tinted cells are off-boundary — a specialized technique correctly staying green ` +
    `on a bug it does not defend; red is an open gap${open === 0 ? ' (none today)' : ''}; faint cells ` +
    `are not applicable or not yet run. Full per-cell detail is in docs/detection-matrix.md.`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${fullHeight}" width="${width}" height="${fullHeight}" role="img" aria-labelledby="t d">
<title id="t">The detection matrix: every deliberate bug versus the techniques that defend it</title>
<desc id="d">${desc}</desc>
${groups.join('\n')}
${legendParts.join('\n')}
</svg>
`
}
