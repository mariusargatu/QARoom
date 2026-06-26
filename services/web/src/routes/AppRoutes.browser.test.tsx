/// <reference types="@vitest/browser/matchers" />
import { EXAMPLE_HANDLE, EXAMPLE_USER_ID } from '@qaroom/contracts'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { withProviders } from '../test-support/with-providers'
import { AppRoutes } from './AppRoutes'

// Wiring test (ADR-0027): AppRoutes is the route table — public `/login`, the session-gated consumer +
// operator surfaces behind `RequireSession`/`AppShellRoute`, and the catch-all. These tests drive the
// router at representative paths to prove each guard branch resolves to the right element: the picker
// for a signed-out visitor, the bounce-to-login for a guarded path without a session, the page inside
// the shell once signed in (via the index redirect), and the not-found page for an unknown path.

const signIn = () =>
  localStorage.setItem(
    'qaroom.session',
    JSON.stringify({
      token: 'header.payload.sig',
      currentUser: { id: EXAMPLE_USER_ID, handle: EXAMPLE_HANDLE, display_name: 'Ada Lovelace' },
    }),
  )

test('the /login route renders the identity picker for a signed-out visitor', async () => {
  localStorage.clear()
  const screen = await render(withProviders(<AppRoutes />, { path: '/login' }))

  await expect.element(screen.getByRole('heading', { name: 'Welcome to QARoom' })).toBeVisible()
})

test('a guarded route bounces a signed-out visitor to the login picker', async () => {
  localStorage.clear()
  const screen = await render(withProviders(<AppRoutes />, { path: '/communities' }))

  await expect.element(screen.getByRole('heading', { name: 'Welcome to QARoom' })).toBeVisible()
})

test('the index route redirects a signed-in visitor to communities inside the app shell', async () => {
  localStorage.clear()
  signIn()
  const screen = await render(withProviders(<AppRoutes />, { path: '/' }))

  await expect.element(screen.getByRole('heading', { name: 'Communities' })).toBeVisible()
})

test('an unknown path renders the catch-all not-found page', async () => {
  localStorage.clear()
  const screen = await render(withProviders(<AppRoutes />, { path: '/no-such-route' }))

  await expect.element(screen.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})
