/// <reference types="@vitest/browser/matchers" />
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { ErrorState } from './ErrorState'

// Molecule component test (ADR-0027, composition-delta): ErrorState composes the proven Card + Button
// atoms; this covers only what the MOLECULE adds — the retryable branch (mirroring the RFC 7807
// `retryable` hint) that gates whether the retry button renders and wires it to `onRetry`.

test('a retryable error shows a retry button that calls onRetry', async () => {
  const onRetry = vi.fn()
  const screen = await render(
    <ErrorState message="flags-service is unreachable." onRetry={onRetry} />,
  )

  await screen.getByRole('button', { name: 'Try again' }).click()

  expect(onRetry).toHaveBeenCalledTimes(1)
})

test('a non-retryable error shows no retry button', async () => {
  const screen = await render(
    <ErrorState message="No post with that id exists." retryable={false} onRetry={() => {}} />,
  )

  await expect.element(screen.getByRole('alert')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Try again' }).query()).toBeNull()
})
