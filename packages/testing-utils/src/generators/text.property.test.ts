import { test } from '@fast-check/vitest'
import { CreatePostRequest } from '@qaroom/contracts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { configureFastCheck } from '../fast-check-seed'
import {
  bidiTextArb,
  emojiArb,
  isWellFormed,
  unicodeCreatePostRequestArb,
  userBodyArb,
  userTitleArb,
} from './text'

/**
 * The Unicode generators carry two obligations, both checked here:
 *  1. WITHIN-CONTRACT — every draw satisfies `CreatePostRequest`, so a wired create is always a 201
 *     and the generator can never spuriously redden the Zod-OpenAPI parity gate (it stays on the
 *     valid, code-unit-bounded side of the maxLength code-unit/code-point divergence).
 *  2. NON-VACUOUS — the distribution actually contains emoji, bidi controls, NFD (non-NFC) forms, and
 *     an at-limit value. Without this guard a generator that silently degraded to ASCII (e.g. a
 *     fast-check default change) would let the wired fidelity test pass without exercising anything.
 */
configureFastCheck()

const codePoints = (s: string): string[] => Array.from(s)
const hasAstral = (s: string): boolean =>
  codePoints(s).some((c) => (c.codePointAt(0) ?? 0) > 0xffff)
const hasBidiControl = (s: string): boolean => /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/.test(s)
const hasRtlLetter = (s: string): boolean => /[\u0590-\u06FF]/.test(s)
const isNonNfc = (s: string): boolean => s.normalize('NFC') !== s
const NUL = '\u0000'

describe('Unicode user-text generators are contract-valid', () => {
  test.prop([unicodeCreatePostRequestArb])(
    'every generated CreatePostRequest body is accepted by the Zod contract (so a wired create is a 201)',
    (body) => {
      expect(CreatePostRequest.safeParse(body).success).toBe(true)
    },
  )

  test.prop([userTitleArb])(
    'a generated title is 1-300 code units, NUL-free, and well-formed UTF-16',
    (title) => {
      expect(title.length).toBeGreaterThanOrEqual(1)
      expect(title.length).toBeLessThanOrEqual(300)
      expect(title.includes(NUL)).toBe(false)
      expect(isWellFormed(title)).toBe(true)
    },
  )

  test.prop([userBodyArb()])(
    'a generated body is 0-1000 code units, NUL-free, and well-formed UTF-16',
    (body) => {
      expect(body.length).toBeGreaterThanOrEqual(0)
      expect(body.length).toBeLessThanOrEqual(1000)
      expect(body.includes(NUL)).toBe(false)
      expect(isWellFormed(body)).toBe(true)
    },
  )

  test.prop([bidiTextArb])(
    'bidiTextArb always embeds a bidirectional control and an RTL letter (the Trojan-Source surface)',
    (text) => {
      expect(hasBidiControl(text)).toBe(true)
      expect(hasRtlLetter(text)).toBe(true)
    },
  )
})

describe('Unicode user-text generators are non-vacuous', () => {
  // Deterministic sample (explicit seed): each class must appear so the wired fidelity test exercises it.
  const titles = fc.sample(userTitleArb, { numRuns: 500, seed: 0x7e16 })
  const emojis = fc.sample(emojiArb, { numRuns: 200, seed: 0x7e16 })

  it('the title distribution contains an emoji (astral) value', () => {
    expect(titles.some(hasAstral)).toBe(true)
  })

  it('the title distribution contains a bidirectional control', () => {
    expect(titles.some(hasBidiControl)).toBe(true)
  })

  it('the title distribution contains a decomposed (non-NFC) value', () => {
    expect(titles.some(isNonNfc)).toBe(true)
  })

  it('the title distribution reaches the 300-code-unit max-length boundary', () => {
    expect(titles.some((t) => t.length === 300)).toBe(true)
  })

  it('emojiArb yields multi-code-unit graphemes (String.length lies)', () => {
    expect(emojis.some((e) => e.length > codePoints(e).length || hasAstral(e))).toBe(true)
  })
})
