import { describe, expect, it } from 'vitest'
import {
  blocks,
  buildPrompt,
  changedManifests,
  costUsd,
  type Finding,
  guardrailPathFor,
  parseFindings,
  removedSymbols,
  renderEvidence,
  summariseGates,
  unchangedSpecsFor,
} from './reviewer-agent'

function finding(severity: Finding['severity']): Finding {
  return { severity, file: 'services/content/src/x.ts', rule: 'r', why: 'w' }
}

describe('blocks — P2 and above gate Lane A', () => {
  it('blocks on P0/P1/P2', () => {
    expect(blocks([finding('P0')])).toBe(true)
    expect(blocks([finding('P1')])).toBe(true)
    expect(blocks([finding('P2')])).toBe(true)
  })

  it('does not block on P3-only or empty', () => {
    expect(blocks([finding('P3')])).toBe(false)
    expect(blocks([])).toBe(false)
  })
})

describe('guardrailPathFor — own AGENTS.md, else root', () => {
  it('uses a boundary that has its own AGENTS.md', () => {
    expect(guardrailPathFor('services/content')).toBe('services/content/AGENTS.md')
    expect(guardrailPathFor('packages/contracts')).toBe('packages/contracts/AGENTS.md')
  })

  it('falls back to the root AGENTS.md for a boundary without one', () => {
    expect(guardrailPathFor('services/does-not-exist')).toBe('AGENTS.md')
  })
})

describe('costUsd — vendored per-1M prices', () => {
  it('prices input and output tokens', () => {
    // 2M input @ $0.05/1M + 1M output @ $0.4/1M = 0.10 + 0.40 = 0.50
    expect(
      costUsd(
        { prompt_tokens: 2_000_000, completion_tokens: 1_000_000 },
        { inputPer1m: 0.05, outputPer1m: 0.4 },
      ),
    ).toBeCloseTo(0.5, 10)
  })

  it('is zero for no tokens', () => {
    expect(costUsd({ prompt_tokens: 0, completion_tokens: 0 })).toBe(0)
  })
})

describe('parseFindings — trust nothing the model returns', () => {
  it('parses a valid findings payload', () => {
    const text = JSON.stringify({
      findings: [
        { severity: 'P1', file: 'a.ts', line: 3, rule: 'no-mutation', why: 'mutates input' },
      ],
    })
    expect(parseFindings(text)).toHaveLength(1)
  })

  it('accepts an empty findings array (clean review)', () => {
    expect(parseFindings(JSON.stringify({ findings: [] }))).toEqual([])
  })

  it('throws on a bad severity (no silent approve)', () => {
    const text = JSON.stringify({
      findings: [{ severity: 'LOW', file: 'a.ts', rule: 'r', why: 'w' }],
    })
    expect(() => parseFindings(text)).toThrow()
  })

  it('throws on non-JSON', () => {
    expect(() => parseFindings('not json')).toThrow()
  })
})

describe('buildPrompt', () => {
  it('embeds the boundary, guardrail, and diff', () => {
    const p = buildPrompt('GUARD TEXT', 'DIFF TEXT', 'services/content')
    expect(p).toContain('services/content')
    expect(p).toContain('GUARD TEXT')
    expect(p).toContain('DIFF TEXT')
    expect(p).toContain('P3 style (never blocks)')
  })

  it('embeds the verified-evidence block when given one', () => {
    const p = buildPrompt('G', 'D', 'services/content', 'EVIDENCE BLOCK')
    expect(p).toContain('EVIDENCE BLOCK')
    expect(p).toContain('contradicts the VERIFIED EVIDENCE')
  })
})

describe('removedSymbols — what the diff deletes/un-exports', () => {
  it('captures removed export declarations and barrel members', () => {
    const diff = [
      '--- a/x.ts', // header line, must be ignored despite the leading -
      '+++ b/x.ts',
      '-export const CallTheApi = () => {}',
      '-export function helper() {}',
      '-export interface StreamSource {}',
      '-export { Foo, type Bar } from "./y"',
      '+const kept = 1',
      ' unchanged',
    ].join('\n')
    expect(removedSymbols(diff).sort()).toEqual(
      ['Bar', 'CallTheApi', 'Foo', 'StreamSource', 'helper'].sort(),
    )
  })

  it('returns nothing when no exports were removed', () => {
    expect(removedSymbols('-  const local = 1\n+  const local = 2')).toEqual([])
  })
})

describe('summariseGates — per-runner pass/fail from the envelope', () => {
  it('maps failed=0 to passed', () => {
    const json = JSON.stringify({
      runners: [
        { name: '@qaroom/gateway', passed: 40, failed: 0 },
        { name: '@qaroom/web', passed: 5, failed: 2 },
      ],
    })
    expect(summariseGates(json)).toEqual([
      { name: '@qaroom/gateway', passed: true },
      { name: '@qaroom/web', passed: false },
    ])
  })

  it('is empty (not a throw) on unreadable input', () => {
    expect(summariseGates('not json')).toEqual([])
  })
})

describe('changedManifests — single-source direction', () => {
  it('flags a touched manifest', () => {
    expect(changedManifests(['scripts/lib/manifests/claims.ts', 'x.ts'])).toEqual([
      'scripts/lib/manifests/claims.ts',
    ])
  })

  it('is empty when only projections changed', () => {
    expect(changedManifests(['docs/structurizr/model/testing.dsl'])).toEqual([])
  })
})

describe('unchangedSpecsFor — drift-gated specs that did not move', () => {
  it('lists a real boundary spec when it is not in the changed set', () => {
    // gateway/openapi.yaml exists on disk; with no changed files it is unchanged.
    expect(unchangedSpecsFor('services/gateway', [])).toContain('services/gateway/openapi.yaml')
  })

  it('excludes a spec that did change', () => {
    expect(unchangedSpecsFor('services/gateway', ['services/gateway/openapi.yaml'])).not.toContain(
      'services/gateway/openapi.yaml',
    )
  })
})

describe('renderEvidence — the refutation rules the judge must apply', () => {
  it('emits the zero-callers rule for removed symbols', () => {
    const block = renderEvidence({
      callers: [{ symbol: 'CallTheApi', callers: 0 }],
      unchangedSpecs: [],
      manifestsChanged: [],
      gates: [],
    })
    expect(block).toContain('CallTheApi: 0 caller(s)')
    expect(block).toContain('callers = 0')
  })

  it('emits the unchanged-spec and manifest-direction rules', () => {
    const block = renderEvidence({
      callers: [],
      unchangedSpecs: ['services/gateway/openapi.yaml'],
      manifestsChanged: [],
      gates: [{ name: '@qaroom/gateway', passed: true }],
    })
    expect(block).toContain('UNCHANGED in this PR: services/gateway/openapi.yaml')
    expect(block).toContain('SYNCED to the manifest')
    expect(block).toContain('0 failing')
  })

  it('omits the manifest-direction rule when a manifest did change', () => {
    const block = renderEvidence({
      callers: [],
      unchangedSpecs: [],
      manifestsChanged: ['scripts/lib/manifests/claims.ts'],
      gates: [],
    })
    expect(block).not.toContain('SYNCED to the manifest')
  })
})
