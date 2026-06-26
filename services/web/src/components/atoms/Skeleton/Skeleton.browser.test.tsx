/// <reference types="@vitest/browser/matchers" />
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { Skeleton } from './Skeleton'

// Atom component test (ADR-0027, composition-delta model). Skeleton is a pure-display loading block;
// the behaviour it ADDS over a styled <div> is being decorative (aria-hidden so the region, not the
// placeholder, announces status) and forwarding props through. Browser required.

test('renders a decorative aria-hidden placeholder', async () => {
  const screen = await render(<Skeleton data-testid="skeleton" />)

  await expect.element(screen.getByTestId('skeleton')).toHaveAttribute('aria-hidden', 'true')
})
