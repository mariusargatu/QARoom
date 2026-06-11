/**
 * The README's one visual mark: the detection matrix as a compact heat-grid SVG, in the visual
 * grammar of GitHub's contribution graph (familiar = instantly legible as "dense evidence grid").
 * Derived entirely from the committed matrix render inputs; no clock, no randomness, so the same
 * artifact always yields byte-identical SVGs (`pnpm matrix:render --check` gates them).
 *
 * Cell semantics follow the design brief: a catch is a filled slate cell, a miss is a hollow cell
 * (an honest gap, not a red alarm), everything else (no code path, not run, key-gated, unstable)
 * is near-invisible. The full per-cell truth lives in docs/detection-matrix.md; this is the shape.
 */

export interface SvgCell {
  status: 'caught' | 'missed' | 'other'
}

export interface SvgTier {
  label: string
  /** rows x columns of cells, row-major; all rows the same length */
  grid: SvgCell[][]
}

const CELL = 12
const GAP = 3
const TIER_GAP = 14
const TOP = 22
const PAD = 2

interface Palette {
  caught: string
  missedStroke: string
  other: string
  label: string
}

// DESIGN.md slate (oklch 0.470 0.078 262) and its dark-surface counterpart, pre-converted to hex
// because GitHub serves these SVGs through <img>, where external CSS cannot reach.
const LIGHT: Palette = {
  caught: '#3f669a',
  missedStroke: '#c3c9d3',
  other: '#eef0f4',
  label: '#6b7280',
}
const DARK: Palette = {
  caught: '#8fb0dc',
  missedStroke: '#4a4f58',
  other: '#1e2126',
  label: '#9aa0aa',
}

export function renderMatrixSvg(tiers: SvgTier[], variant: 'light' | 'dark'): string {
  const p = variant === 'light' ? LIGHT : DARK
  const rows = Math.max(...tiers.map((t) => t.grid.length))
  const height = TOP + rows * (CELL + GAP) + PAD

  let x = PAD
  let labelExtent = 0
  const groups: string[] = []
  for (const tier of tiers) {
    const cols = tier.grid[0]?.length ?? 0
    const cells: string[] = []
    for (let r = 0; r < tier.grid.length; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = tier.grid[r][c]
        const cx = x + c * (CELL + GAP)
        const cy = TOP + r * (CELL + GAP)
        if (cell.status === 'caught') {
          cells.push(
            `<rect x="${cx}" y="${cy}" width="${CELL}" height="${CELL}" rx="2" fill="${p.caught}"/>`,
          )
        } else if (cell.status === 'missed') {
          cells.push(
            `<rect x="${cx + 0.5}" y="${cy + 0.5}" width="${CELL - 1}" height="${CELL - 1}" rx="2" fill="none" stroke="${p.missedStroke}"/>`,
          )
        } else {
          cells.push(
            `<rect x="${cx}" y="${cy}" width="${CELL}" height="${CELL}" rx="2" fill="${p.other}"/>`,
          )
        }
      }
    }
    const width = cols * (CELL + GAP) - GAP
    groups.push(
      `<text x="${x}" y="${TOP - 9}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="10" fill="${p.label}">${tier.label}</text>`,
      ...cells,
    )
    // ~5.4px per character at font-size 10: keeps the last tier's label inside the viewBox even
    // when its grid is narrower than its caption (Tier C is 3 columns wide).
    labelExtent = Math.max(labelExtent, x + Math.ceil(tier.label.length * 5.4))
    x += width + TIER_GAP + GAP
  }
  const width = Math.max(x - TIER_GAP + PAD, labelExtent + PAD)

  const all = tiers.flatMap((t) => t.grid.flat())
  const caught = all.filter((c) => c.status === 'caught').length
  const missed = all.filter((c) => c.status === 'missed').length
  const ghosts = all.length - caught - missed

  // Microlegend: the skeptic this image exists for is the reader who counts squares; all three
  // visual states get named so the faint cells read as "not measured", never as hidden data.
  const ly = height - 12
  const lt = (x: number, text: string) =>
    `<text x="${x}" y="${ly + 9}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="10" fill="${p.label}">${text}</text>`
  const legend = [
    `<rect x="${PAD}" y="${ly}" width="${CELL}" height="${CELL}" rx="2" fill="${p.caught}"/>`,
    lt(PAD + CELL + 5, `caught (${caught})`),
    `<rect x="${PAD + 86}" y="${ly}" width="${CELL - 1}" height="${CELL - 1}" rx="2" fill="none" stroke="${p.missedStroke}"/>`,
    lt(PAD + 86 + CELL + 5, `missed (${missed})`),
    `<rect x="${PAD + 174}" y="${ly}" width="${CELL}" height="${CELL}" rx="2" fill="${p.other}"/>`,
    lt(PAD + 174 + CELL + 5, `not run or n/a (${ghosts})`),
  ].join('\n')
  const fullHeight = height + 22

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${fullHeight}" width="${width}" height="${fullHeight}" role="img" aria-labelledby="t d">
<title id="t">The detection matrix: deliberate bugs versus testing techniques</title>
<desc id="d">A grid of ${caught + missed} measured cells across ${tiers.length} tiers, plus ${ghosts} unmeasured positions. ${caught} filled cells are catches; ${missed} hollow cells are recorded misses; faint cells are not applicable or not yet run. Full per-cell detail is in docs/detection-matrix.md.</desc>
${groups.join('\n')}
${legend}
</svg>
`
}
