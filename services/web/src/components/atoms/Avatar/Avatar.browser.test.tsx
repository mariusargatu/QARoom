/// <reference types="@vitest/browser/matchers" />
import fc from 'fast-check'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { Avatar } from './Avatar'

// Atom component test (ADR-0027, composition-delta model). The Avatar atom ADDS deterministic
// initials derivation + the role=img/aria-label identity over a bare <span>; those are what this
// test covers (colour tints are token classes, not behaviour). Browser required.

test('a two-word name renders both initials and exposes the name as its image label', async () => {
  const screen = await render(<Avatar name="Ada Lovelace" />)

  await expect.element(screen.getByRole('img', { name: 'Ada Lovelace' })).toHaveTextContent('AL')
})

test('a single-word name renders its first two letters', async () => {
  const screen = await render(<Avatar name="ada" />)

  await expect.element(screen.getByRole('img', { name: 'ada' })).toHaveTextContent('AD')
})

test('a branded id derives initials from its trailing characters, not the prefix', async () => {
  const screen = await render(<Avatar name="user_01KTKPMB7QF8Z3J267EZN" />)

  await expect
    .element(screen.getByRole('img', { name: 'user_01KTKPMB7QF8Z3J267EZN' }))
    .toHaveTextContent('ZN')
})

// Property over the whole name-shape space (blank / single word / two words / branded id). Each shape
// has a known initials rule, so this asserts the derivation as a law across the input space, not just
// the three pinned examples above. The blank shape is what closes the empty-`words` `'?'` fallback the
// examples leave to its default. A fixed seed keeps the exercised shapes deterministic (no flake).
const LETTER = fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'x', 'y', 'z')
const WORD = fc.array(LETTER, { minLength: 1, maxLength: 6 }).map((cs) => cs.join(''))
const ALNUM = fc.constantFrom('a', 'b', 'c', '0', '1', '2', '7', '9', 'K', 'T', 'z')
const ID_TAIL = fc.array(ALNUM, { minLength: 2, maxLength: 10 }).map((cs) => cs.join(''))
const PREFIX = fc.constantFrom('user', 'comm', 'sess', 'post', 'key', 'mdec')

const nameShape = fc.oneof(
  // blank / whitespace-only → the single '?' fallback (initials() finds no words).
  fc
    .array(fc.constantFrom(' ', '\t', '\n'), { maxLength: 4 })
    .map((ws) => ({ name: ws.join(''), expected: '?' })),
  // a single plain word → its first two letters, uppercased.
  WORD.map((w) => ({ name: w, expected: w.slice(0, 2).toUpperCase() })),
  // two words → the first letter of each, uppercased.
  fc
    .tuple(WORD, WORD)
    .map(([a, b]) => ({ name: `${a} ${b}`, expected: (a.charAt(0) + b.charAt(0)).toUpperCase() })),
  // a branded id → the last two trailing alphanumerics, never the prefix.
  fc
    .tuple(PREFIX, ID_TAIL)
    .map(([p, t]) => ({ name: `${p}_${t}`, expected: t.slice(-2).toUpperCase() })),
)

test('the rendered initials follow the per-shape derivation rule for any name', async () => {
  await fc.assert(
    fc.asyncProperty(nameShape, async ({ name, expected }) => {
      const screen = await render(<Avatar name={name} />)

      expect(screen.getByRole('img').element().textContent).toBe(expected)

      await screen.unmount()
    }),
    { seed: 20_260_625, numRuns: 60 },
  )
})
