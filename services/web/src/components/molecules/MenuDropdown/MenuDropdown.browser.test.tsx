/// <reference types="@vitest/browser/matchers" />

import fc from 'fast-check'
import { expect, test } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { MenuDropdown } from './MenuDropdown'

// Molecule component test (ADR-0027, composition-delta): the trigger and menu content are passed in,
// so this covers only the open/close shell the MOLECULE itself adds — click-to-open (aria-expanded),
// and the two dismiss paths it installs: Escape and outside-click.

test('the menu opens when its trigger is clicked', async () => {
  const screen = await render(
    <MenuDropdown label="Account menu" trigger="ada">
      <button type="button">Sign out</button>
    </MenuDropdown>,
  )
  const trigger = screen.getByRole('button', { name: 'Account menu' })

  await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.click()

  await expect.element(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect.element(screen.getByRole('menu')).toBeVisible()
})

test('pressing Escape closes an open menu', async () => {
  const screen = await render(
    <MenuDropdown label="Account menu" trigger="ada">
      <button type="button">Sign out</button>
    </MenuDropdown>,
  )
  const trigger = screen.getByRole('button', { name: 'Account menu' })
  await trigger.click()
  await expect.element(trigger).toHaveAttribute('aria-expanded', 'true')

  await userEvent.keyboard('{Escape}')

  await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
})

test('clicking outside closes an open menu', async () => {
  const screen = await render(
    <div>
      <MenuDropdown label="Account menu" trigger="ada">
        <button type="button">Sign out</button>
      </MenuDropdown>
      <button type="button" data-testid="outside">
        elsewhere
      </button>
    </div>,
  )
  const trigger = screen.getByRole('button', { name: 'Account menu' })
  await trigger.click()
  await expect.element(trigger).toHaveAttribute('aria-expanded', 'true')

  await screen.getByTestId('outside').click()

  await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
})

// Property over the keydown space: ONLY Escape dismisses, so any other key leaves an open menu open.
// Closes the false branch of the `e.key === 'Escape'` guard the Escape-only example above leaves
// untouched. Keys that would activate the focused trigger (Enter / Space) are excluded — they toggle
// the button itself, not the keydown path under test. A fixed seed keeps the exercised keys stable.
const nonEscapeKey = fc.constantFrom(
  'a',
  'b',
  'q',
  'x',
  'z',
  '0',
  '5',
  '9',
  '{ArrowDown}',
  '{ArrowUp}',
  '{ArrowLeft}',
  '{ArrowRight}',
  '{Tab}',
  '{Home}',
  '{End}',
)

test('any key other than Escape leaves an open menu open', async () => {
  await fc.assert(
    fc.asyncProperty(nonEscapeKey, async (key) => {
      const screen = await render(
        <MenuDropdown label="Account menu" trigger="ada">
          <button type="button">Sign out</button>
        </MenuDropdown>,
      )
      const trigger = screen.getByRole('button', { name: 'Account menu' })
      await trigger.click()
      await expect.element(trigger).toHaveAttribute('aria-expanded', 'true')

      await userEvent.keyboard(key)

      await expect.element(trigger).toHaveAttribute('aria-expanded', 'true')
      await screen.unmount()
    }),
    { seed: 6_553_653, numRuns: 18 },
  )
})
