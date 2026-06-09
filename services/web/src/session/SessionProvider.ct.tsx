import { expect, test } from '../../playwright'
import { SessionHarness } from './SessionProvider.probe'

// Session behaviour in the CT tier (ADR-0005). localStorage is cleared before the app initialises
// so the roster assertions are deterministic regardless of any prior page state.

test('signs a user in, dedups the known-users roster, and clears state on logout', async ({
  mount,
  page,
}) => {
  await page.addInitScript(() => window.localStorage.clear())
  const component = await mount(<SessionHarness />)

  await expect(component.getByTestId('user')).toHaveText('none')

  await component.getByTestId('signin').click()
  await expect(component.getByTestId('user')).toHaveText('ada')
  await expect(component.getByTestId('known')).toHaveText('1')

  await component.getByTestId('signin').click() // same user id — upsertById must not duplicate
  await expect(component.getByTestId('known')).toHaveText('1')

  await component.getByTestId('logout').click()
  await expect(component.getByTestId('user')).toHaveText('none')
})
