/// <reference types="@vitest/browser/matchers" />

import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { RootErrorBoundary } from './RootErrorBoundary'

// A render-time throw with no boundary above it unmounts the whole tree and leaves a blank page.
// That is how a shape-invalid `qaroom.session` made the app permanently unusable: SessionProvider
// threw during render on every load, and there was nothing to catch it or offer a way out.

function Exploding(): never {
  throw new Error('boom from render')
}

test('a render-time throw is caught instead of blanking the app', async () => {
  // React logs caught errors through console.error; silence only this expected pair.
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  const screen = await render(
    <RootErrorBoundary onReset={() => {}}>
      <Exploding />
    </RootErrorBoundary>,
  )

  await expect.element(screen.getByRole('heading', { name: 'Something broke' })).toBeVisible()
  await expect.element(screen.getByRole('alert')).toHaveTextContent('boom from render')
  quiet.mockRestore()
})

test('the recovery control is offered and invokes the reset', async () => {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  const onReset = vi.fn()
  const screen = await render(
    <RootErrorBoundary onReset={onReset}>
      <Exploding />
    </RootErrorBoundary>,
  )

  await screen.getByRole('button', { name: 'Start over' }).click()

  expect(onReset).toHaveBeenCalledTimes(1)
  quiet.mockRestore()
})

test('a healthy tree renders untouched, so the boundary costs nothing when nothing is wrong', async () => {
  const screen = await render(
    <RootErrorBoundary onReset={() => {}}>
      <p>all good</p>
    </RootErrorBoundary>,
  )

  await expect.element(screen.getByText('all good')).toBeVisible()
  expect(screen.container.querySelector('[role="alert"]')).toBeNull()
})
