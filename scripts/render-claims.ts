import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CLAIMS, type Claim } from '@qaroom/contracts/claims'
import { gateLine, loadSummary, resolveEvidence, type Summary } from './lib/claim-evidence'

/**
 * Render the falsifiable-claim manifest into the SKIMMER projections (Phase 2): a static, zero-JS HTML
 * page (a ruled boundary x claim matrix, not a card grid), a shields.io endpoint badge, and the stable
 * README block. All DERIVED from the one manifest joined to the frozen summary.json: live numbers are
 * read, never hand-typed, and an absent/stale runner renders amber (honest), never a faked green. The
 * README block carries NO live numbers so it stays byte-comparable (claims:verify drift-gates it).
 *
 *   pnpm claims:render            write docs/claims/{index.html,badge.json}
 *   pnpm claims:render --readme   print the stable README block to stdout (for injection + the gate)
 */

const ROOT = process.cwd()
const OUT_DIR = resolve(ROOT, 'docs/claims')
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function verdict(): { line: string; verified: number; stale: number } {
  const summary = loadSummary()
  let verified = 0
  let stale = 0
  for (const claim of CLAIMS) {
    if (resolveEvidence(claim, summary).stale) stale++
    else verified++
  }
  const boundaries = new Set(CLAIMS.map((c) => c.boundary)).size
  const staleNote = stale > 0 ? ` (${stale} stale until summary.json is regenerated in CI)` : ''
  return {
    line: `${CLAIMS.length} falsifiable claims across ${boundaries} boundaries. ${verified} verified${staleNote}`,
    verified,
    stale,
  }
}

function byBoundary(): [string, Claim[]][] {
  const m = new Map<string, Claim[]>()
  for (const c of CLAIMS) m.set(c.boundary, [...(m.get(c.boundary) ?? []), c])
  return [...m].sort()
}

const COLS = 4

function rowHtml(claim: Claim, summary: Summary | null): string {
  const ev = resolveEvidence(claim, summary)
  const state = ev.stale ? 'stale' : 'verified'
  const label = ev.stale ? 'STALE' : 'VERIFIED'
  const evText = ev.value === null ? 'unresolved' : `${claim.evidence.field}=${ev.value}`
  return `        <tr class="${state}">
          <td class="status"><span class="dot"></span><span class="lbl">${label}</span></td>
          <td class="claim"><code class="id">${esc(claim.id)}</code><span class="sentence">${esc(claim.claim)}</span><span class="caught">caught by <code>${esc(gateLine(claim))}</code></span></td>
          <td class="ev"><code>${esc(claim.toggle)}</code><span class="evv">${esc(evText)}</span><span class="prov">${esc(ev.provenance)}</span></td>
          <td class="fls"><code>pnpm prove ${esc(claim.id)} --break</code></td>
        </tr>`
}

function renderHtml(): string {
  const summary = loadSummary()
  const v = verdict()
  const groups = byBoundary()
    .map(
      ([boundary, claims]) =>
        `        <tr class="grp"><th colspan="${COLS}">${esc(boundary)}</th></tr>\n${claims
          .map((c) => rowHtml(c, summary))
          .join('\n')}`,
    )
    .join('\n')
  const foot = summary
    ? `summary.json, commit ${summary.commit?.slice(0, 7) ?? 'unknown'}, generated ${summary.generated_at}`
    : 'no test-results/summary.json'
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QARoom falsifiable claims</title>
<style>
  :root {
    --bg: oklch(0.165 0.008 255); --line: oklch(0.30 0.008 255); --grp: oklch(0.22 0.008 255);
    --fg: oklch(0.94 0.006 255); --dim: oklch(0.64 0.008 255);
    --green: oklch(0.76 0.15 150); --amber: oklch(0.82 0.13 80);
    --mono: ui-monospace, "SF Mono", "Cascadia Code", "Menlo", monospace;
    --sans: system-ui, -apple-system, "Segoe UI", "Helvetica Neue", sans-serif;
    --s-fact: 0.8rem; --s-body: 1.02rem;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--mono);
         line-height: 1.5; -webkit-font-smoothing: antialiased; font-size: var(--s-fact); }
  main { max-width: 1180px; margin: 0 auto; padding: clamp(2.5rem, 6vw, 5rem) clamp(1rem, 4vw, 2rem) 6rem; }
  header { margin-bottom: clamp(2rem, 5vw, 3.5rem); max-width: 70ch; }
  h1 { font-family: var(--sans); font-size: clamp(1.9rem, 5vw, 2.5rem); font-weight: 680;
       letter-spacing: -0.02em; line-height: 1.1; margin: 0 0 1rem; }
  .tag { font-family: var(--sans); color: var(--dim); font-size: var(--s-body); margin: 0; }
  .tag b { color: var(--fg); font-weight: 600; }
  .tag code { font-family: var(--mono); font-size: 0.92em; color: var(--fg); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.8rem 0.9rem; vertical-align: top; border-bottom: 1px solid var(--line); }
  thead th { font-size: var(--s-fact); text-transform: uppercase; letter-spacing: 0.07em; color: var(--dim);
             font-weight: 500; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg); }
  tr.grp th { background: var(--grp); color: var(--fg); font-size: var(--s-fact); text-transform: uppercase;
              letter-spacing: 0.12em; font-weight: 600; padding-top: 1.1rem; }
  .status { white-space: nowrap; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--amber); margin-right: 0.5rem;
         vertical-align: middle; }
  tr.verified .dot { background: var(--green); }
  .lbl { font-size: var(--s-fact); letter-spacing: 0.04em; color: var(--amber); vertical-align: middle; }
  tr.verified .lbl { color: var(--green); }
  .claim { max-width: 46ch; }
  .id { display: inline-block; font-weight: 650; color: var(--fg); margin-right: 0.5rem; }
  .sentence { font-family: var(--sans); font-size: var(--s-body); color: var(--fg); }
  .caught, .prov { display: block; color: var(--dim); margin-top: 0.45rem; }
  .caught code, .ev code { color: var(--fg); word-break: break-word; }
  .ev .evv { display: block; margin-top: 0.45rem; color: var(--fg); }
  .ev .prov { font-size: var(--s-fact); }
  .fls code { color: var(--green); white-space: nowrap; }
  footer { margin-top: 2.5rem; color: var(--dim); font-size: var(--s-fact); max-width: 80ch; }
  @media (prefers-reduced-motion: no-preference) { .dot { transition: background 0.2s; } }
  @media (max-width: 720px) { .table-wrap { overflow-x: auto; } table { min-width: 680px; } }
</style></head>
<body><main>
  <header>
    <h1>Don't trust the green check. Flip the switch.</h1>
    <p class="tag">QARoom ships the bug that breaks each guarantee and the gate that catches it. <b>${esc(v.line)}.</b> Run <code>pnpm prove &lt;id&gt; --break</code> and watch a gate go red.</p>
  </header>
  <div class="table-wrap"><table>
    <thead><tr><th>Status</th><th>Claim</th><th>Breaks when / evidence</th><th>Falsify</th></tr></thead>
    <tbody>
${groups}
    </tbody>
  </table></div>
  <footer>Derived live from ${esc(foot)}. This page cannot show green without a passing run; an unresolved claim renders amber, not green. ADR: demo-as-tested-surface.</footer>
</main></body></html>
`
}

function renderBadge(): string {
  const v = verdict()
  const color = v.stale > 0 ? 'orange' : 'brightgreen'
  return `${JSON.stringify(
    { schemaVersion: 1, label: 'claims', message: `${CLAIMS.length} falsifiable`, color },
    null,
    2,
  )}\n`
}

// Stable README block, manifest projection only (NO live numbers), so it is byte-comparable and
// drift-gated by claims:verify. Numbers live on the HTML page + badge (regenerated in CI).
export const README_START =
  '<!-- claims:start (generated by `pnpm claims:render --readme`; do not edit) -->'
export const README_END = '<!-- claims:end -->'
export function renderReadmeBlock(): string {
  const rows = CLAIMS.map(
    (c) => `| ${c.claim} | \`${c.boundary}\` | \`${c.toggle}\` | \`pnpm prove ${c.id} --break\` |`,
  ).join('\n')
  return `${README_START}
### Falsifiable claims

> Don't trust the green check. Flip the switch. Every claim comes with the bug that breaks it and the test that catches that bug. You run one command, a real test turns red. The status is read from the test run, not typed by hand. Full list and the matrix: \`pnpm prove\`.

| Claim | Boundary | Breaks when | Falsify |
|---|---|---|---|
${rows}
${README_END}`
}

function main(): void {
  if (process.argv.includes('--readme')) {
    process.stdout.write(`${renderReadmeBlock()}\n`)
    return
  }
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(resolve(OUT_DIR, 'index.html'), renderHtml())
  writeFileSync(resolve(OUT_DIR, 'badge.json'), renderBadge())
  process.stdout.write(`wrote docs/claims/index.html + badge.json (${CLAIMS.length} claims)\n`)
}

// Run only when invoked directly; importing for renderReadmeBlock (claims-verify) must be side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
