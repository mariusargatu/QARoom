import { describe, expect, it } from 'vitest'
import {
  blocks,
  buildPrompt,
  costUsd,
  type Finding,
  guardrailPathFor,
  parseFindings,
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
})
