import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// `pnpm verify` (the local fast lane) and ci.yml's `verify` job are two hand-maintained gate lists.
// When they drift, a derived-doc drift gate can run locally but NOT in CI, so the doc rots on main
// with every CI check green — the concrete case the 2026-07-10 audit found: `adr:index --check` and
// `anchored:coverage` were local-only. This test asserts every gate in `pnpm verify` also runs in the
// CI verify job, except a NAMED, justified allow-list of deltas — so a new local gate can't silently
// skip CI, and AGENTS.md's "mirrors the CI verify job" claim stays honest. Runs via `pnpm test:scripts`.
// ponytail: if the allow-list grows, promote _integration's lane list to a shared derived source.
const ROOT = resolve(__dirname, '..')
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
const ciYml = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')

// The script names `pnpm verify` chains (split on &&, take the leading `pnpm <name>` token of each).
const verifyGates = pkg.scripts.verify
  .split('&&')
  .map((seg) => seg.trim().match(/^pnpm\s+([a-z][a-z0-9:_-]*)/)?.[1])
  .filter((name): name is string => name !== undefined)

// Deltas that are in `pnpm verify` but legitimately run DIFFERENTLY (or not) in the CI verify job.
// Each MUST carry its reason here — this comment is the "named allow-list" that keeps the drift honest.
const ALLOWED_DELTAS: Record<string, string> = {
  // Runs in CI as `pnpm exec turbo run typecheck --filter=!@qaroom/moderator-agent` (uv-less lane).
  typecheck: 'runs via turbo in CI (moderator pyright is in the _integration lane)',
  // Advisory sidecar generator (ADR-0033), not a merge gate — deliberately not a CI step.
  'anchored:coverage': 'advisory sidecar (ADR-0033), not a CI gate by design',
  // CI runs the census half as `pnpm tsx scripts/detection-matrix.ts --check`; the rendered-matrix
  // /SVG drift half runs in the _integration matrix lane, not the PR lane.
  'matrix:verify':
    'census half runs in CI as detection-matrix.ts --check; render half in _integration',
}

describe('pnpm verify and the CI verify job stay in parity', () => {
  it('parses a non-trivial verify gate list (not vacuously green)', () => {
    expect(verifyGates.length).toBeGreaterThan(10)
  })

  it.each(
    verifyGates.filter((g) => !(g in ALLOWED_DELTAS)).map((g) => [g] as const),
  )('CI verify job runs `pnpm %s` (or it is a named delta)', (gate) => {
    expect(ciYml).toContain(`pnpm ${gate}`)
  })

  it('adr:index runs in CI (pins the 2026-07-10 fix so the ADR index cannot drift on main)', () => {
    expect(ciYml).toContain('pnpm adr:index --check')
  })
})
