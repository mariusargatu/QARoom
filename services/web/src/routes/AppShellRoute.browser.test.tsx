/// <reference types="@vitest/browser/matchers" />
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { withProviders } from '../test-support/with-providers'
import { AppShellRoute } from './AppShellRoute'

// Route-wrapper composition-delta test (ADR-0027): AppShellRoute wires session + theme into the
// already-proven Masthead and renders the routed page in the AppShell template's `<Outlet>`. The
// tests cover only the wrapper's own delta — that the outlet renders inside the shell, and that
// sign-out logs out + redirects to /login — not the Masthead/AppShell internals.

test('renders the routed page in the shell outlet', async () => {
  const screen = await render(
    withProviders(
      <Routes>
        <Route element={<AppShellRoute />}>
          <Route path="/" element={<div data-testid="outlet">feed</div>} />
        </Route>
      </Routes>,
    ),
  )

  await expect.element(screen.getByTestId('outlet')).toHaveTextContent('feed')
})

test('signing out clears the session and redirects to /login', async () => {
  localStorage.setItem(
    'qaroom.session',
    JSON.stringify({
      token: 'header.payload.sig',
      currentUser: { id: 'user_01HZY0K7M3QF8VN2J5RX9TB4CF', handle: 'ada', display_name: 'Ada' },
    }),
  )
  const screen = await render(
    withProviders(
      <Routes>
        <Route element={<AppShellRoute />}>
          <Route path="/" element={<div data-testid="outlet">feed</div>} />
        </Route>
        <Route path="/login" element={<div data-testid="screen">login</div>} />
      </Routes>,
    ),
  )

  // Sign out lives inside the Masthead's account dropdown — open it first.
  await screen.getByRole('button', { name: 'Account menu' }).click()
  await screen.getByRole('button', { name: 'Sign out' }).click()

  await expect.element(screen.getByTestId('screen')).toHaveTextContent('login')
})
