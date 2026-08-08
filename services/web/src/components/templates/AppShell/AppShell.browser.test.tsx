/// <reference types="@vitest/browser/matchers" />

import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { AppShell } from './AppShell'

// Templates had NO component test. That is defensible for pure layout — except a template's whole
// job is the landmark structure, and nothing was asserting it: swapping AppShell's `<main>` for a
// `<div>` passed the component suite AND the story a11y suite, because axe's `landmark-one-main` is
// a best-practice rule the story gate does not enforce and no story renders a full page anyway.
// A screen-reader user loses "skip to main content" and the primary navigation landmark.

test('the shell wraps routed content in a main landmark', async () => {
  const screen = await render(
    <AppShell masthead={<div>masthead</div>}>
      <p>routed page</p>
    </AppShell>,
  )

  const main = screen.getByRole('main')
  await expect.element(main).toBeVisible()
  await expect.element(main).toHaveTextContent('routed page')
})

test('the masthead slot renders outside the main landmark, not inside it', async () => {
  // Landmarks must not nest: a banner inside `main` is a structural error that also breaks
  // landmark navigation, and slot order is exactly what a layout template is responsible for.
  const screen = await render(
    <AppShell masthead={<header>masthead</header>}>
      <p>routed page</p>
    </AppShell>,
  )

  const main = screen.container.querySelector('main')
  expect(main?.querySelector('header')).toBeNull()
  expect(screen.container.querySelector('header')).not.toBeNull()
})
