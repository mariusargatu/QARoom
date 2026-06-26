/// <reference types="@vitest/browser/matchers" />
import { TESTID } from '@qaroom/testing-utils/testids'
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { RolloutStepper } from './RolloutStepper'

// Molecule component test (ADR-0027, composition-delta): RolloutStepper composes the proven Badge +
// Button atoms; this covers only what the MOLECULE adds — surfacing the current state in the badge,
// rendering one advance button per legal event and emitting that exact event, and the pending lockout.

test('shows the current state and advances with the clicked event', async () => {
  const onAdvance = vi.fn()
  const screen = await render(
    <RolloutStepper
      state="Enabling"
      legalEvents={['CanaryConfirmed', 'RolloutAborted']}
      onAdvance={onAdvance}
    />,
  )

  await expect.element(screen.getByTestId(TESTID.rolloutState)).toHaveTextContent('Enabling')
  await screen.getByTestId(TESTID.rolloutAdvance('RolloutAborted')).click()

  expect(onAdvance).toHaveBeenCalledWith('RolloutAborted')
})

test('pending disables the advance buttons', async () => {
  const screen = await render(
    <RolloutStepper state="Off" legalEvents={['EnableRequested']} pending onAdvance={vi.fn()} />,
  )

  await expect.element(screen.getByTestId(TESTID.rolloutAdvance('EnableRequested'))).toBeDisabled()
})
