/// <reference types="@vitest/browser/matchers" />
import fc from 'fast-check'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { Card } from './Card'

// Atom component test (ADR-0027, composition-delta model). Card is a pure-display surface container —
// `interactive` only toggles hover token classes, so the behaviour it ADDS over a <div> is rendering
// the wrapped content. A minimal render + one assertion is the right depth here. Browser required.

test('renders the content it wraps', async () => {
  const screen = await render(<Card>A surface container.</Card>)

  await expect.element(screen.getByText('A surface container.')).toBeVisible()
})

// Property over the only variant prop: the hover-lift affordance classes are present exactly when the
// card is interactive, and never otherwise. Closes the `interactive` true branch the example test
// above leaves to its `false` default. A fixed seed keeps both cases deterministically exercised.
test('the hover-lift affordance is present exactly when the card is interactive', async () => {
  await fc.assert(
    fc.asyncProperty(fc.boolean(), async (interactive) => {
      const screen = await render(<Card interactive={interactive}>surface</Card>)
      const root = screen.container.firstElementChild as HTMLElement

      expect(root.classList.contains('hover:border-primary')).toBe(interactive)
      expect(root.classList.contains('transition')).toBe(interactive)

      await screen.unmount()
    }),
    { seed: 314_159, numRuns: 12 },
  )
})
