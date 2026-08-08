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
  // WHERE the escape hatch goes, not merely that one exists: asserting only visibility means the
  // link could point anywhere — including back at the 404 — and the test would still pass.
  await expect
    .element(screen.getByRole('link', { name: 'Go to communities' }))
    .toHaveAttribute('href', '/communities')
})

// This page renders OUTSIDE AppShellRoute (it is the `*` route, reachable with no session), so it
// inherits no landmark from the shell. Without its own `<main>`, an axe scan of the running app
// reported `landmark-one-main` and `region` here.
test('the 404 page carries its own main landmark, having no shell to inherit one from', async () => {
  const screen = await render(withProviders(<NotFoundPage />))

  await expect.element(screen.getByRole('main')).toBeVisible()
})
