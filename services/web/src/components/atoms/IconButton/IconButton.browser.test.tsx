/// <reference types="@vitest/browser/matchers" />
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { IconButton } from './IconButton'

// Atom component test (ADR-0027, composition-delta model). Over a bare <button> the IconButton atom
// ADDS the required `label` -> aria-label mapping (an icon-only control must announce itself) and
// forwards click/disabled through. Those are what this test covers. Browser required.

test('the required label becomes the button accessible name', async () => {
  const screen = await render(<IconButton label="Upvote">▲</IconButton>)

  await expect.element(screen.getByRole('button', { name: 'Upvote' })).toBeVisible()
})

test('clicking dispatches onClick', async () => {
  const onClick = vi.fn()
  const screen = await render(
    <IconButton label="Upvote" onClick={onClick}>
      ▲
    </IconButton>,
  )

  await screen.getByRole('button', { name: 'Upvote' }).click()

  expect(onClick).toHaveBeenCalledTimes(1)
})

test('disabled renders a disabled control', async () => {
  const screen = await render(
    <IconButton label="Upvote" disabled>
      ▲
    </IconButton>,
  )

  await expect.element(screen.getByRole('button', { name: 'Upvote' })).toBeDisabled()
})
