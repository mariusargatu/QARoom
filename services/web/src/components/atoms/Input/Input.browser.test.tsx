/// <reference types="@vitest/browser/matchers" />
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { Input } from './Input'

// Atom component test (ADR-0027, composition-delta model). Over a bare <input> the Input atom ADDS
// the `invalid` -> aria-invalid mapping and forwards typed input through (the {...rest} pass-through).
// Those are what this test covers; the token styling is not behaviour. Browser required.

test('accepts typed text', async () => {
  const screen = await render(<Input aria-label="Community slug" />)
  const field = screen.getByRole('textbox', { name: 'Community slug' })

  await field.fill('general')

  await expect.element(field).toHaveValue('general')
})

test('invalid marks the field aria-invalid', async () => {
  const screen = await render(<Input aria-label="Community slug" invalid />)

  await expect
    .element(screen.getByRole('textbox', { name: 'Community slug' }))
    .toHaveAttribute('aria-invalid', 'true')
})

test('a valid field carries no aria-invalid attribute', async () => {
  const screen = await render(<Input aria-label="Community slug" />)

  await expect
    .element(screen.getByRole('textbox', { name: 'Community slug' }))
    .not.toHaveAttribute('aria-invalid')
})
