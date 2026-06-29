/**
 * The README's one visual mark: the detection matrix as a labelled heat-grid SVG. Every bug is a
 * named row, every technique a named column, and a catch carries a ✓ glyph so the image is legible
 * at a glance (and colour-blind safe) instead of an abstract field of tints. Derived entirely from
 * the committed matrix render inputs; no clock, no randomness, so the same artifact always yields
 * byte-identical SVGs (`pnpm matrix:render --check` gates them).
 *
 * Coverage-first: a left COVERAGE STRIP shows each bug's bug-level coverage (every bug should have a
 * defender), and the grid is a relevance gradient, NOT pass/fail — a catch is a strong fill + ✓, an
 * off-boundary green is a soft tint that RECEDES (a specialized technique correctly ignoring a bug it
 * does not defend, not a hole), and the only alarming colour is `open` red + ! (a bug caught by
 * nothing that ran). The full per-cell truth lives in docs/detection-matrix.md; this is the shape.
 */

export interface SvgCell {
  status: 'caught' | 'off-boundary' | 'open' | 'other'
}

export interface SvgTier {
  label: string
  /** Column (technique) names, left-to-right, one per grid column. */
  columns: string[]
  /** rows x columns of cells, row-major; all rows the same length and aligned to the coverage strip. */
  grid: SvgCell[][]
}

/** One mark in the left coverage strip — a bug's bug-level coverage, plus its row label. */
export interface CoverageMark {
  status: 'in-proc' | 'deeper' | 'awaiting' | 'open'
  /** The bug's short name, shown as the row label. */
  label: string
}

const CELL = 13
const GAP = 3
const TIER_GAP = 20
const PAD = 2
const CHAR = 5.4 // ~px per character at font-size 10, for legend/header width
const ROW_LABEL_SIZE = 9
const COL_LABEL_SIZE = 8.5
const ROW_CHAR = 4.9 // ~px per char at ROW_LABEL_SIZE
const COL_CHAR = 4.6 // ~px per char at COL_LABEL_SIZE
const HEADER = 92 // header band height (title + explainer + headline)

interface Palette {
  caught: string
  offBoundary: string
  open: string
  other: string
  coverDeeper: string
  coverAwaiting: string
  label: string
  glyph: string // colour of the ✓ / ! drawn inside a strong cell
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
  glyph: '#ffffff',
}
const DARK: Palette = {
  caught: '#8fb0dc',
  offBoundary: '#2c333d',
  open: '#e06c5b',
  other: '#1e2126',
  coverDeeper: '#5f7ba6',
  coverAwaiting: '#caa45f',
  label: '#9aa0aa',
  glyph: '#10141a',
}

const titleColor = (p: Palette) => (p === LIGHT ? '#111827' : '#e6e8eb')
const font = 'ui-sans-serif, system-ui, sans-serif'

const fillRect = (x: number, y: number, fill: string) =>
  `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${fill}"/>`

const glyphAt = (x: number, y: number, ch: string, fill: string) =>
  `<text x="${x + CELL / 2}" y="${y + CELL - 3.5}" font-family="${font}" font-size="10" font-weight="700" fill="${fill}" text-anchor="middle">${ch}</text>`

// A grid cell: the fill plus, for the two load-bearing states, a glyph so the meaning survives
// greyscale / colour-blindness (a catch is ✓, an open gap is !). Off-boundary and n/a stay bare.
const gridCellSvg = (cell: SvgCell, x: number, y: number, p: Palette): string => {
  if (cell.status === 'caught') return fillRect(x, y, p.caught) + glyphAt(x, y, '✓', p.glyph)
  if (cell.status === 'open') return fillRect(x, y, p.open) + glyphAt(x, y, '!', p.glyph)
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

const text = (
  x: number,
  y: number,
  size: number,
  fill: string,
  s: string,
  opts: { weight?: string; anchor?: string } = {},
) =>
  `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${opts.weight ?? 'normal'}" fill="${fill}" text-anchor="${opts.anchor ?? 'start'}">${s}</text>`

export function renderMatrixSvg(
  tiers: SvgTier[],
  coverage: CoverageMark[],
  variant: 'light' | 'dark',
): string {
  const p = variant === 'light' ? LIGHT : DARK
  const rows = coverage.length

  // Left gutter sized to the longest bug name; row labels are right-aligned against it.
  const rowLabelW = Math.ceil(Math.max(0, ...coverage.map((m) => m.label.length)) * ROW_CHAR)
  const gutterRight = PAD + rowLabelW
  const stripX = gutterRight + 8

  // Column-header band height: tall enough for the longest rotated technique label.
  const longestCol = Math.max(
    1,
    ...tiers.flatMap((t) => t.columns.map((c) => c.length)),
    'coverage'.length,
  )
  const colHeadH = Math.ceil(longestCol * COL_CHAR) + 8
  const gridTop = HEADER + colHeadH
  const height = gridTop + rows * (CELL + GAP) + PAD

  const groups: string[] = []
  let rightExtent = 0

  // ---- header band (plain-language intro + headline stat) ----
  const cov = {
    inProc: coverage.filter((m) => m.status === 'in-proc').length,
    deeper: coverage.filter((m) => m.status === 'deeper').length,
    awaiting: coverage.filter((m) => m.status === 'awaiting').length,
    open: coverage.filter((m) => m.status === 'open').length,
  }
  const caughtBugs = cov.inProc + cov.deeper
  const awaitingNote = cov.awaiting > 0 ? ` · ${cov.awaiting} awaiting a deeper lane` : ''
  const headerLines: [number, number, string, string, string][] = [
    [18, 14, titleColor(p), 'Detection matrix: do the tests catch a planted bug?', '600'],
    [40, 10.5, p.label, 'Each row is one deliberately planted bug; each column is a testing technique trying to catch it,', 'normal'],
    [55, 10.5, p.label, 'grouped into in-process, live-cluster, and LLM lanes. A ✓ is a catch; a soft tint is a technique', 'normal'],
    [70, 10.5, p.label, 'correctly ignoring a bug outside its area; blank is not-applicable. A sparse grid is specialization.', 'normal'],
    [88, 11.5, p.caught, `${caughtBugs} of ${rows} bugs caught · ${cov.open} open gaps${awaitingNote}`, '600'],
  ]
  for (const [y, size, fill, s, weight] of headerLines) groups.push(text(PAD, y, size, fill, s, { weight }))
  rightExtent = Math.max(rightExtent, PAD + Math.ceil(96 * CHAR))

  // ---- row labels (one bug per row, right-aligned in the gutter) ----
  for (let r = 0; r < rows; r++) {
    const cy = gridTop + r * (CELL + GAP) + CELL - 3
    groups.push(text(gutterRight, cy, ROW_LABEL_SIZE, p.label, coverage[r].label, { anchor: 'end' }))
  }

  // ---- coverage strip (one cell per bug) ----
  const colLabel = (cx: number, label: string) =>
    `<text x="${cx}" y="${gridTop - 6}" font-family="${font}" font-size="${COL_LABEL_SIZE}" fill="${p.label}" text-anchor="start" transform="rotate(-90 ${cx} ${gridTop - 6})">${label}</text>`

  groups.push(colLabel(stripX + CELL / 2 + 3, 'coverage'))
  for (let r = 0; r < rows; r++) {
    const y = gridTop + r * (CELL + GAP)
    groups.push(fillRect(stripX, y, coverColor(coverage[r], p)))
    if (coverage[r].status === 'in-proc' || coverage[r].status === 'deeper')
      groups.push(glyphAt(stripX, y, '✓', p.glyph))
    if (coverage[r].status === 'open') groups.push(glyphAt(stripX, y, '!', p.glyph))
  }
  rightExtent = Math.max(rightExtent, stripX + CELL)

  // ---- tier grids, each with rotated per-column technique labels ----
  let x = stripX + CELL + TIER_GAP
  for (const tier of tiers) {
    const cols = tier.columns.length
    // tier caption above its column labels (its text can be wider than the columns it spans)
    groups.push(text(x, HEADER + 4, 10, p.label, tier.label, { weight: '600' }))
    rightExtent = Math.max(rightExtent, x + Math.ceil(tier.label.length * CHAR))
    for (let c = 0; c < cols; c++) {
      const cx = x + c * (CELL + GAP) + CELL / 2 + 3
      groups.push(colLabel(cx, tier.columns[c]))
    }
    for (let r = 0; r < tier.grid.length; r++) {
      for (let c = 0; c < cols; c++) {
        groups.push(gridCellSvg(tier.grid[r][c], x + c * (CELL + GAP), gridTop + r * (CELL + GAP), p))
      }
    }
    rightExtent = Math.max(rightExtent, x + cols * (CELL + GAP) - GAP)
    x += cols * (CELL + GAP) - GAP + TIER_GAP
  }

  // ---- legend ----
  const all = tiers.flatMap((t) => t.grid.flat())
  const caught = all.filter((c) => c.status === 'caught').length
  const offBoundary = all.filter((c) => c.status === 'off-boundary').length
  const open = all.filter((c) => c.status === 'open').length
  const ghosts = all.filter((c) => c.status === 'other').length

  const ly = height + 6
  let lx = PAD
  const legendParts: string[] = []
  const entry = (fill: string, glyph: string, label: string) => {
    legendParts.push(fillRect(lx, ly, fill))
    if (glyph) legendParts.push(glyphAt(lx, ly, glyph, p.glyph))
    legendParts.push(
      `<text x="${lx + CELL + 5}" y="${ly + 10}" font-family="${font}" font-size="10" fill="${p.label}">${label}</text>`,
    )
    lx += CELL + 5 + Math.ceil(label.length * CHAR) + 16
  }
  entry(p.caught, '✓', `caught (${caught})`)
  entry(p.offBoundary, '', `off-boundary, ran green (${offBoundary})`)
  entry(p.open, '!', `open gap (${open})`)
  entry(p.other, '', `n/a or not run (${ghosts})`)
  rightExtent = Math.max(rightExtent, lx)

  const defended = cov.inProc + cov.deeper
  const desc =
    `Coverage strip: ${defended} of ${rows} deliberate bugs caught ` +
    `(${cov.awaiting} awaiting a deeper lane, ${cov.open} open gaps). Each row is a named bug, each ` +
    `column a named technique. A ✓ cell is a catch; a soft-tinted cell is off-boundary — a specialized ` +
    `technique correctly staying green on a bug it does not defend; a red ! is an open gap` +
    `${open === 0 ? ' (none today)' : ''}; blank cells are not applicable or not yet run. Full per-cell ` +
    `detail is in docs/detection-matrix.md.`

  const width = Math.ceil(Math.max(rightExtent, x) + PAD)
  const fullHeight = Math.ceil(ly + CELL + 6)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${fullHeight}" width="${width}" height="${fullHeight}" role="img" aria-labelledby="t d">
<title id="t">The detection matrix: every deliberate bug versus the techniques that defend it</title>
<desc id="d">${desc}</desc>
${groups.join('\n')}
${legendParts.join('\n')}
</svg>
`
}
