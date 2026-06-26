/// <reference types="@vitest/browser/matchers" />

import fc from 'fast-check'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { Masthead } from './Masthead'

// Organism component test (ADR-0027, composition-delta model): Masthead composes the proven
// Avatar/Button atoms + MenuDropdown molecule (open/close is already covered there). These cover only
// what the ORGANISM adds — the theme-toggle label flip, wiring communities into the switcher, and the
// signed-in-only account menu with its sign-out action. A MemoryRouter supplies routing for the links.

const ADA = { id: 'user_1', handle: 'ada', display_name: 'Ada Lovelace' }
const COMMUNITIES = [
  { id: 'comm_1', slug: 'general', name: 'General' },
  { id: 'comm_2', slug: 'dev', name: 'Developers' },
]

function renderMasthead(props: Partial<Parameters<typeof Masthead>[0]> = {}) {
  return render(
    <MemoryRouter>
      <Masthead
        currentUser={ADA}
        communities={COMMUNITIES}
        theme="light"
        onToggleTheme={vi.fn()}
        onSignOut={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  )
}

test('the theme toggle offers the opposite theme and fires on click', async () => {
  const onToggleTheme = vi.fn()
  const screen = await renderMasthead({ theme: 'light', onToggleTheme })

  // theme 'light' → the control offers to switch to 'Dark'.
  await screen.getByRole('button', { name: 'Dark' }).click()

  expect(onToggleTheme).toHaveBeenCalledOnce()
})

test('opening the community switcher lists each community by name', async () => {
  const screen = await renderMasthead()

  await screen.getByRole('button', { name: 'Switch community' }).click()

  await expect.element(screen.getByRole('link', { name: 'General' })).toBeVisible()
  await expect.element(screen.getByRole('link', { name: 'Developers' })).toBeVisible()
})

test('the account menu signs the viewer out', async () => {
  const onSignOut = vi.fn()
  const screen = await renderMasthead({ onSignOut })

  await screen.getByRole('button', { name: 'Account menu' }).click()
  await screen.getByRole('button', { name: 'Sign out' }).click()

  expect(onSignOut).toHaveBeenCalledOnce()
})

test('a signed-out masthead exposes no account menu', async () => {
  const screen = await renderMasthead({ currentUser: null, communities: [] })

  expect(screen.getByRole('button', { name: 'Account menu' }).query()).toBeNull()
})

// Property over the `theme` prop: the toggle always offers ONLY the opposite theme and never the
// current one. Closes the `theme === 'dark'` true branch the example test above leaves to its 'light'
// case. A fixed seed keeps both themes deterministically exercised.
// Total lookups over the finite theme union (a Record, not a Map — access is `string`, no assertion).
const OPPOSITE: Record<'dark' | 'light', string> = { dark: 'Light', light: 'Dark' }
const SAME: Record<'dark' | 'light', string> = { dark: 'Dark', light: 'Light' }

test('the theme toggle offers only the opposite theme, for either theme', async () => {
  await fc.assert(
    fc.asyncProperty(fc.constantFrom<'dark' | 'light'>('dark', 'light'), async (theme) => {
      const screen = await renderMasthead({ theme })

      expect(screen.getByRole('button', { name: OPPOSITE[theme] }).query()).not.toBeNull()
      expect(screen.getByRole('button', { name: SAME[theme] }).query()).toBeNull()

      await screen.unmount()
    }),
    { seed: 8_675_309, numRuns: 12 },
  )
})
