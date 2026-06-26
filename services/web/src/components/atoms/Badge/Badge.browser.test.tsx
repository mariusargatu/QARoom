/// <reference types="@vitest/browser/matchers" />
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { Badge } from './Badge'

// Atom component test (ADR-0027, composition-delta model). Badge is a pure-display status pill —
// tone is a token class, so the only behaviour it ADDS over a <span> is rendering its children as
// the pill content. A minimal render + one assertion is the right depth here. Browser required.

test('renders its content as a status pill', async () => {
  const screen = await render(<Badge>Enabled</Badge>)

  await expect.element(screen.getByText('Enabled')).toBeVisible()
})
