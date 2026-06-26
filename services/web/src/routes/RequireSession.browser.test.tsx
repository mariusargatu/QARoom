/// <reference types="@vitest/browser/matchers" />
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { GuardedRoutes } from './RequireSession.probe'

// Route-guard oracle (ADR-0027, supersedes the Playwright-CT version of ADR-0005). Nothing else
// asserts that RequireSession actually GATES: a regression to "always render the child" would expose
// every authed surface to an anonymous client and survive every other gate. These pin both branches.
// The session is seeded/cleared in localStorage (key `qaroom.session`, read by SessionProvider's init)
// BEFORE render — and because Vitest browser mode runs the test IN the browser, that is a direct
// localStorage call, no page.addInitScript needed. Browser required.

test('with no session, the guard redirects to /login', async () => {
  localStorage.removeItem('qaroom.session')
  const screen = await render(<GuardedRoutes />)
  await expect.element(screen.getByTestId('screen')).toHaveTextContent('login')
})

test('with a session, the guard renders the protected child', async () => {
  localStorage.setItem(
    'qaroom.session',
    JSON.stringify({
      token: 'header.payload.sig',
      currentUser: { id: 'user_01HZY0K7M3QF8VN2J5RX9TB4CF', handle: 'ada', display_name: 'Ada' },
    }),
  )
  const screen = await render(<GuardedRoutes />)
  await expect.element(screen.getByTestId('screen')).toHaveTextContent('protected')
})
