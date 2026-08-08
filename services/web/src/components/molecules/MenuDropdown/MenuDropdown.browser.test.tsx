/// <reference types="@vitest/browser/matchers" />

import fc from 'fast-check'
import { expect, test } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { MenuDropdown } from './MenuDropdown'

// Molecule component test (ADR-0027, composition-delta): the trigger and menu content are passed in,
// so this covers only the open/close shell the MOLECULE itself adds — click-to-open (aria-expanded),
// and the three dismiss paths it installs: Escape, outside-click, and selecting an item.

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
  await expect.element(screen.getByRole('button', { name: 'Sign out' })).toBeVisible()
})

// This is a DISCLOSURE, not an ARIA menu: the panel holds ordinary links and buttons, and the
// component implements none of the `role="menu"` keyboard contract (arrow-key roving focus). Claiming
// the role while its children are plain links is an axe `aria-required-children` violation — a real
// one, found by scanning the running app — so the trigger points at the panel with `aria-controls`
// and neither element claims a menu role. Pinning it here stops the role being "helpfully" restored.
test('the popover is a disclosure the trigger owns, not an ARIA menu', async () => {
  const screen = await render(
    <MenuDropdown label="Account menu" trigger="ada">
      <button type="button">Sign out</button>
    </MenuDropdown>,
  )
  const trigger = screen.getByRole('button', { name: 'Account menu' })
  await trigger.click()

  await expect.element(trigger).not.toHaveAttribute('aria-haspopup', 'menu')
  expect(document.querySelector('[role="menu"]')).toBeNull()
  const controls = document.querySelector('[aria-controls]')?.getAttribute('aria-controls')
  expect(controls).toBeTruthy()
  expect(document.getElementById(controls as string)).not.toBeNull()
})

// The component has always DOCUMENTED this ("clicking anywhere inside closes it", "items close it by
// navigating") and never implemented it: in the running app, picking Profile from the masthead
// navigated to /u/<id> with the popover still hanging over the new page.
test('selecting an item closes the menu', async () => {
  const screen = await render(
    <MenuDropdown label="Account menu" trigger="ada">
      <button type="button">Sign out</button>
    </MenuDropdown>,
  )
  const trigger = screen.getByRole('button', { name: 'Account menu' })
  await trigger.click()
  await expect.element(trigger).toHaveAttribute('aria-expanded', 'true')

  await screen.getByRole('button', { name: 'Sign out' }).click()

  await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
})

// Escape must also hand focus back, or a keyboard user is dropped at the top of the document with no
// way back to the control they just dismissed.
test('Escape returns focus to the trigger it came from', async () => {
  const screen = await render(
    <MenuDropdown label="Account menu" trigger="ada">
      <button type="button">Sign out</button>
    </MenuDropdown>,
  )
  const trigger = screen.getByRole('button', { name: 'Account menu' })
  await trigger.click()

  await userEvent.keyboard('{Escape}')

  await expect.element(trigger).toHaveFocus()
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
