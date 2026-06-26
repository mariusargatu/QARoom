/// <reference types="@vitest/browser/matchers" />
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { Textarea } from './Textarea'

// Atom component test (ADR-0027, composition-delta model). Over a bare <textarea> the Textarea atom
// ADDS a six-row default, the `invalid` -> aria-invalid mapping, and forwards typed input through.
// Those are what this test covers; the token styling is not behaviour. Browser required.

test('accepts typed multi-line input', async () => {
  const screen = await render(<Textarea aria-label="Post body" />)
  const field = screen.getByRole('textbox', { name: 'Post body' })

  await field.fill('A short note on deterministic clocks.')

  await expect.element(field).toHaveValue('A short note on deterministic clocks.')
})

test('defaults to six rows', async () => {
  const screen = await render(<Textarea aria-label="Post body" />)

  await expect
    .element(screen.getByRole('textbox', { name: 'Post body' }))
    .toHaveAttribute('rows', '6')
})

test('invalid marks the field aria-invalid', async () => {
  const screen = await render(<Textarea aria-label="Post body" invalid />)

  await expect
    .element(screen.getByRole('textbox', { name: 'Post body' }))
    .toHaveAttribute('aria-invalid', 'true')
})
