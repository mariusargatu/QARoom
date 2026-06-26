/// <reference types="@vitest/browser/matchers" />
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { withProviders } from '../../../test-support/with-providers'
import { NotFoundPage } from './NotFoundPage'

// Page test (ADR-0027): NotFoundPage is a static catch-all — no hooks, no data states. It composes the
// proven EmptyState molecule + Button atom; the only page-level delta is naming the missing route and
// offering a Link back to communities (which needs the router `withProviders` supplies). A minimal
// render assertion is enough.

test('the 404 page names the missing route and offers a way back to communities', async () => {
  const screen = await render(withProviders(<NotFoundPage />))

  await expect.element(screen.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await expect.element(screen.getByRole('link', { name: 'Go to communities' })).toBeVisible()
})
