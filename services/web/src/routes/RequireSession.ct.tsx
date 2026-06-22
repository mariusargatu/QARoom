import { expect, test } from '../../playwright'
import { GuardedRoutes } from './RequireSession.probe'

// Route-guard oracle (ADR-0005: component behaviour lives in the CT tier, no Vitest DOM). Nothing
// else asserts that RequireSession actually GATES: a regression to "always render the child" would
// expose every authed surface to an anonymous client and survive every gate. These pin both
// branches. The session is seeded/cleared in localStorage (key `qaroom.session`, read by
// SessionProvider's init) BEFORE mount, so the guard sees it on first render.

test('with no session, the guard redirects to /login', async ({ mount, page }) => {
  await page.evaluate(() => window.localStorage.removeItem('qaroom.session'))
  await mount(<GuardedRoutes />)
  await expect(page.getByTestId('screen')).toHaveText('login')
})

test('with a session, the guard renders the protected child', async ({ mount, page }) => {
  await page.evaluate(() =>
    window.localStorage.setItem(
      'qaroom.session',
      JSON.stringify({
        token: 'header.payload.sig',
        currentUser: { id: 'user_01HZY0K7M3QF8VN2J5RX9TB4CF', handle: 'ada', display_name: 'Ada' },
      }),
    ),
  )
  await mount(<GuardedRoutes />)
  await expect(page.getByTestId('screen')).toHaveText('protected')
})
