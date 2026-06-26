/// <reference types="@vitest/browser/matchers" />
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { Spinner } from './Spinner'

// Atom component test (ADR-0027, composition-delta model). Over a styled <span> the Spinner atom ADDS
// the accessible loading affordance: role=status named by `label` (defaulting to "Loading"). That is
// what this test covers; the spin animation is a token class, not behaviour. Browser required.

test('defaults to an accessible "Loading" status', async () => {
  const screen = await render(<Spinner />)

  await expect.element(screen.getByRole('status', { name: 'Loading' })).toBeVisible()
})

test('a custom label names the status', async () => {
  const screen = await render(<Spinner label="Saving" />)

  await expect.element(screen.getByRole('status', { name: 'Saving' })).toBeVisible()
})
