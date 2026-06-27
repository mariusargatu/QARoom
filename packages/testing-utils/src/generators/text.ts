import type { CreatePostRequest } from '@qaroom/contracts'
import fc from 'fast-check'
import { userIdArb } from './ids'

/**
 * Unicode-aware user-content text arbitraries (T16).
 *
 * The fleet's request-body generators draw titles/bodies from `fc.string()`, whose default
 * `grapheme-ascii` unit emits printable ASCII only (empirically: no astral, no combining, no
 * control). That leaves the part of the input space real global social text actually occupies —
 * emoji, combining marks, bidirectional (RTL) runs, and the NFC/NFD normalization forms — entirely
 * unexercised. These arbitraries fill that gap WITHOUT widening the contract:
 *
 *  - The `grapheme` unit never emits a NUL or C0/C1 control char, and every curated unit below is a
 *    printable / format code point, so every value satisfies the `NO_NUL` field rule.
 *  - Each builder is length-bounded in UTF-16 code units (`String.length`, the unit `z.string()`
 *    `.min/.max` count), so values stay inside a field's max-length AND never cross the code-unit /
 *    code-point boundary where the Zod contract (`.max`, code units) and its generated OpenAPI
 *    `maxLength` (code points) disagree. That divergence is a real, separate finding — out of scope
 *    here; staying on the valid side keeps these generators from spuriously reddening the
 *    Zod-OpenAPI round-trip parity gate.
 *  - `isWellFormed` rejects unpaired surrogates, so every value survives a UTF-8 (Postgres / JSON)
 *    round-trip byte-identical — the property the wired fidelity test asserts.
 *
 * Invisible or normalization-ambiguous code points (combining marks, ZWJ, variation selectors, bidi
 * controls, RTL letters) are written as `\u` escapes so this source stays reviewable and stable
 * against a re-save; visible, unambiguous scripts (CJK, Greek, Cyrillic, Thai, precomposed Latin)
 * are literals.
 */

// A surrogate pair must be matched; an unpaired surrogate is ill-formed UTF-16 and would not survive
// a UTF-8 (Postgres / JSON) round-trip. Lib-version-independent (no `String.prototype.isWellFormed`).
const WELL_FORMED = /^(?:[^\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/
/** True iff `s` has no unpaired UTF-16 surrogate — i.e. it round-trips through UTF-8 unchanged. */
export const isWellFormed = (s: string): boolean => WELL_FORMED.test(s)

// --- Curated grapheme pools, one well-formed unit per entry ---

// Mixed ASCII (letters, digits, punctuation, space) — the LTR baseline real text is interleaved with.
const ASCII_UNITS = [...'aZ0 9.,!?-_/@#']

// Visible multi-locale scripts (i18n surface): CJK, Hangul, Greek, Cyrillic, Thai, precomposed Latin.
const SCRIPT_UNITS = [
  '日',
  '本',
  '語',
  '中',
  '文',
  '한',
  '국',
  '어',
  'Ω',
  'π',
  'Я',
  'ж',
  'ก',
  'ส',
  'é',
  'ñ',
  'ü',
  'ø',
  'ß',
]

// Right-to-left letters (Arabic, Hebrew), escaped so this source stays visually LTR for review.
const RTL_UNITS = [
  '\u0627',
  '\u0644',
  '\u0639',
  '\u0631',
  '\u0628',
  '\u064A',
  '\u0629',
  '\u05E9',
  '\u05DC',
  '\u05D5',
  '\u05DD',
  '\u05D0',
]

// Bidirectional format/override controls (Unicode category Cf) — the Trojan-Source reordering surface.
// Allowed by `NO_NUL`; a system that silently strips them for "safety" mutates user content.
const BIDI_CONTROLS = [
  '\u202A',
  '\u202B',
  '\u202C',
  '\u202D',
  '\u202E',
  '\u200E',
  '\u200F',
  '\u2066',
  '\u2067',
  '\u2068',
  '\u2069',
]

// Canonically DECOMPOSED (NFD) base+combining sequences, escaped so the decomposed form is stable
// against a re-save. Each composes under NFC, so a value drawing from this pool satisfies
// `value.normalize('NFC') !== value` — exercising normalization preservation.
const COMBINING_UNITS = [
  'e\u0301',
  'a\u0300',
  'o\u0302',
  'n\u0303',
  'u\u0308',
  'c\u0327',
  's\u030C',
  'A\u030A',
]

// Emoji classes: BMP symbol+VS16, keycap, astral, skin-tone modifier, ZWJ sequence, regional-indicator
// flag. All but the bare BMP cases are multi-code-unit graphemes — the classic "String.length lies".
const EMOJI_UNITS = [
  '\u2764\uFE0F',
  '5\uFE0F\u20E3',
  '#\uFE0F\u20E3',
  '\u{1F600}',
  '\u{1F389}',
  '\u{1F525}',
  '\u{1F44B}\u{1F3FD}',
  '\u{1F9D1}\u200D\u{1F4BB}',
  '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}',
  '\u{1F1EF}\u{1F1F5}',
  '\u{1F1FA}\u{1F1F8}',
]

/** One grapheme drawn from every interesting Unicode class, plus a raw full-unicode grapheme. */
const textUnitArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...ASCII_UNITS),
  fc.constantFrom(...SCRIPT_UNITS),
  fc.constantFrom(...RTL_UNITS),
  fc.constantFrom(...BIDI_CONTROLS),
  fc.constantFrom(...COMBINING_UNITS),
  fc.constantFrom(...EMOJI_UNITS),
  fc.string({ unit: 'grapheme', minLength: 1, maxLength: 1 }).filter(isWellFormed),
)

export interface TextLengthOptions {
  /** Lower bound, UTF-16 code units (`String.length`). `0` permits the empty string. Default `1`. */
  readonly minCodeUnits?: number
  /** Upper bound, UTF-16 code units (`String.length`). Default `300`. */
  readonly maxCodeUnits?: number
}

/**
 * Arbitrary realistic global user text: a run of mixed-class graphemes (ASCII, CJK / Greek / Cyrillic
 * / Thai, Arabic / Hebrew RTL, bidi controls, NFD combining sequences, emoji incl. ZWJ / skin-tone /
 * flags). Bounded by UTF-16 code units so it stays inside a field's max-length, never contains a NUL
 * or control char, and never carries an unpaired surrogate.
 */
export function unicodeTextArb(opts: TextLengthOptions = {}): fc.Arbitrary<string> {
  const min = opts.minCodeUnits ?? 1
  const max = opts.maxCodeUnits ?? 300
  // A unit spans 1–11 code units; cap the unit COUNT at ~max/3 so the joined length lands near `max`
  // and the code-unit filter only trims a heavy-emoji tail (keeping the filter-rejection rate low).
  const maxUnits = Math.max(1, Math.ceil(max / 3))
  return fc
    .array(textUnitArb, { minLength: min === 0 ? 0 : 1, maxLength: maxUnits })
    .map((units) => units.join(''))
    .filter((s) => s.length >= min && s.length <= max && isWellFormed(s))
}

/**
 * Text at exactly `limit` UTF-16 code units — the VALID side of a max-length boundary (off-by-one).
 * A leading astral emoji (2 code units) over ASCII filler exercises both length-counting regimes at
 * the limit.
 */
export function atMaxLengthArb(limit: number): fc.Arbitrary<string> {
  return fc.constant(`\u{1F600}${'a'.repeat(Math.max(0, limit - 2))}`.slice(0, limit))
}

/**
 * A single emoji spanning the interesting classes (BMP+VS16, keycap, astral, skin-tone, ZWJ sequence,
 * regional-indicator flag) — the multi-code-unit grapheme surface.
 */
export const emojiArb = fc.constantFrom(...EMOJI_UNITS)

/**
 * Text guaranteed to carry bidirectional controls around an RTL run embedded in LTR text — the
 * Trojan-Source reordering surface. Allowed by `NO_NUL`; must survive storage byte-identical.
 */
export const bidiTextArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...ASCII_UNITS),
    fc.constantFrom(...BIDI_CONTROLS),
    fc.array(fc.constantFrom(...RTL_UNITS), { minLength: 1, maxLength: 6 }).map((u) => u.join('')),
    fc.constantFrom(...BIDI_CONTROLS),
    fc.constantFrom(...ASCII_UNITS),
  )
  .map((parts) => parts.join(''))

/** A post TITLE: 1–300 code units of mixed-class Unicode, with an occasional at-limit (300) draw. */
export const userTitleArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: unicodeTextArb({ minCodeUnits: 1, maxCodeUnits: 300 }) },
  { weight: 1, arbitrary: atMaxLengthArb(300) },
)

/** A post BODY: 0–`maxCodeUnits` (default 1000) code units of mixed-class Unicode; may be empty. */
export function userBodyArb(maxCodeUnits = 1000): fc.Arbitrary<string> {
  return unicodeTextArb({ minCodeUnits: 0, maxCodeUnits })
}

/**
 * A `CreatePostRequest` body whose title/body are Unicode-rich (emoji, bidi, NFD, at-limit) yet
 * always contract-valid — a drop-in for `createPostRequestArb` that exercises global text. The
 * generator round-trip self-test asserts every draw satisfies `CreatePostRequest`, so a wired create
 * is always a 201.
 */
export const unicodeCreatePostRequestArb: fc.Arbitrary<CreatePostRequest> = fc.record({
  author_id: userIdArb,
  title: userTitleArb,
  body: userBodyArb(),
})
