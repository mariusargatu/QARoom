import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  boundaryOf,
  type ChangedFile,
  classify,
  loadInvariantGlobs,
  matchesGlob,
  SIZE_CAP,
} from './pr-classify'

// The real CODEOWNERS is the single source of invariant paths. Parsing it here (not a fixture)
// proves the classifier and the repo agree on what is load-bearing — if someone adds an invariant
// path, these tests start guarding it for free.
const codeownersPath = fileURLToPath(new URL('../.github/CODEOWNERS', import.meta.url))
const invariantGlobs = loadInvariantGlobs(readFileSync(codeownersPath, 'utf8'))

function file(path: string, churn = 10): ChangedFile {
  return { path, churn }
}

// One row per worked example in ADR-0026 "Worked examples".
describe('classify — the ADR-0026 worked examples', () => {
  it('adds a test to one service -> Lane A (merges itself)', () => {
    expect(classify([file('services/content/src/foo.test.ts', 80)], invariantGlobs).lane).toBe('A')
  })

  it('typo across 3 services -> Lane B (cross-boundary)', () => {
    const files = [
      file('services/content/README.md', 4),
      file('services/gateway/README.md', 4),
      file('services/donations/README.md', 4),
    ]
    expect(classify(files, invariantGlobs).lane).toBe('B')
  })

  it('widens a contract bound -> Lane C (invariant source)', () => {
    expect(classify([file('packages/contracts/src/vote.ts', 3)], invariantGlobs).lane).toBe('C')
  })

  it('edits a lint rule AND code in one diff -> Lane B (gate self-weakening)', () => {
    const files = [
      file('tools/eslint-plugin-qaroom/src/no-bare-fetch.ts', 20),
      file('services/content/src/client.ts', 20),
    ]
    const result = classify(files, invariantGlobs)
    expect(result.lane).toBe('B')
    expect(result.reasons[0]).toContain('gate self-weakening')
  })

  it('600-line refactor in one service -> Lane B (over size cap)', () => {
    expect(classify([file('services/donations/src/repository.ts', 600)], invariantGlobs).lane).toBe(
      'B',
    )
  })
})

describe('classify — edges', () => {
  it('gate-only change (a workflow alone) still needs a human -> Lane B', () => {
    const result = classify([file('.github/workflows/ci.yml', 5)], invariantGlobs)
    expect(result.lane).toBe('B')
    expect(result.reasons[0]).toContain('enforcement (gate) edit')
  })

  it('a claims-manifest touch -> Lane C and flags the technique change', () => {
    const result = classify([file('scripts/lib/manifests/claims.ts', 12)], invariantGlobs)
    expect(result.lane).toBe('C')
    expect(result.reasons.some((r) => r.includes('technique'))).toBe(true)
  })

  it('spec change -> Lane C', () => {
    expect(classify([file('spec/WebhookDelivery.tla', 9)], invariantGlobs).lane).toBe('C')
  })

  it('excludes the lockfile from the size count (real code stays small -> Lane A)', () => {
    const files = [file('services/content/src/foo.ts', 80), file('pnpm-lock.yaml', 5000)]
    expect(classify(files, invariantGlobs).lane).toBe('A')
  })

  it('invariant wins over size and boundary (first match)', () => {
    const files = [
      file('packages/contracts/src/vote.ts', 5000),
      file('services/content/src/foo.ts', 5000),
    ]
    expect(classify(files, invariantGlobs).lane).toBe('C')
  })

  it('empty diff -> Lane A (nothing to gate)', () => {
    expect(classify([], invariantGlobs).lane).toBe('A')
  })

  it('exactly at the cap is allowed; one over is not', () => {
    expect(classify([file('services/content/src/a.ts', SIZE_CAP)], invariantGlobs).lane).toBe('A')
    expect(classify([file('services/content/src/a.ts', SIZE_CAP + 1)], invariantGlobs).lane).toBe(
      'B',
    )
  })
})

describe('loadInvariantGlobs — parses the real CODEOWNERS', () => {
  it('extracts the contract authority and drops comments/owners', () => {
    expect(invariantGlobs).toContain('/packages/contracts/**')
    expect(invariantGlobs).toContain('/spec/**')
    expect(invariantGlobs.every((g) => !g.startsWith('#'))).toBe(true)
    expect(invariantGlobs.every((g) => !g.includes('@'))).toBe(true)
  })
})

describe('matchesGlob — the two CODEOWNERS shapes', () => {
  it('root-anchored dir glob matches nested files but not a sibling prefix', () => {
    expect(matchesGlob('packages/contracts/src/x.ts', '/packages/contracts/**')).toBe(true)
    expect(matchesGlob('packages/contracts', '/packages/contracts/**')).toBe(true)
    expect(matchesGlob('packages/contracts-extra/x.ts', '/packages/contracts/**')).toBe(false)
  })

  it('exact-file pattern matches only that file', () => {
    const pat = '/docs/adr/0001-foundational-decisions.md'
    expect(matchesGlob('docs/adr/0001-foundational-decisions.md', pat)).toBe(true)
    expect(matchesGlob('docs/adr/0002-other.md', pat)).toBe(false)
  })
})

describe('boundaryOf', () => {
  it('maps services and packages to their module, others to the top dir', () => {
    expect(boundaryOf('services/content/src/foo.ts')).toBe('services/content')
    expect(boundaryOf('packages/contracts/src/x.ts')).toBe('packages/contracts')
    expect(boundaryOf('docs/adr/x.md')).toBe('docs')
    expect(boundaryOf('turbo.json')).toBe('repo-root')
  })
})
