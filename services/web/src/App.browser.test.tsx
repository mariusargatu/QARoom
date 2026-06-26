/// <reference types="@vitest/browser/matchers" />
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { App } from './App'
import { withProviders } from './test-support/with-providers'

// Wiring test (ADR-0027): App is the composition root — it mounts `AppRoutes` under the providers that
// `main.tsx` wires in production. `withProviders` supplies those same providers plus a MemoryRouter, so
// rendering App at a known path proves it actually mounts the router and resolves a route (rather than
// rendering nothing). The route table's own branches are covered in AppRoutes.browser.test.tsx.

test('App mounts the router and resolves the /login route', async () => {
  localStorage.clear()
  const screen = await render(withProviders(<App />, { path: '/login' }))

  await expect.element(screen.getByRole('heading', { name: 'Welcome to QARoom' })).toBeVisible()
})
