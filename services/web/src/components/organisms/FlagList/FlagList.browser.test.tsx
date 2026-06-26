/// <reference types="@vitest/browser/matchers" />
import { EXAMPLE_AS_OF, EXAMPLE_COMMUNITY_ID } from '@qaroom/contracts'
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { FlagList } from './FlagList'

// Organism component test (ADR-0027, composition-delta model): FlagList composes the proven
// RolloutStepper molecule + Skeleton atom. What the organism ADDS is mapping each flag to a row headed
// by its key, injecting the flag key into onAdvance, scoping the pending lock to one flag by key, and
// the loading / empty / error fallbacks. Those are covered; the stepper's own state badge + per-event
// button rendering is not re-asserted.

const flag = (flag_key: string, state: 'Off' | 'Enabled') => ({
  community_id: EXAMPLE_COMMUNITY_ID,
  flag_key,
  state,
  enabled: state === 'Enabled',
  as_of: EXAMPLE_AS_OF,
})

test('each resolved flag renders a row headed by its key', async () => {
  const screen = await render(
    <FlagList
      flags={[flag('donations', 'Enabled'), flag('dark-mode', 'Off')]}
      onAdvance={vi.fn()}
    />,
  )

  await expect.element(screen.getByRole('heading', { name: 'donations' })).toBeVisible()
  await expect.element(screen.getByRole('heading', { name: 'dark-mode' })).toBeVisible()
})

test('advancing a flag reports that flag key with the chosen event', async () => {
  const onAdvance = vi.fn()
  const screen = await render(<FlagList flags={[flag('dark-mode', 'Off')]} onAdvance={onAdvance} />)

  await screen.getByRole('button', { name: 'EnableRequested' }).click()

  expect(onAdvance).toHaveBeenCalledWith('dark-mode', 'EnableRequested')
})

test('pending scopes the lock to the named flag only', async () => {
  const screen = await render(
    <FlagList
      flags={[flag('donations', 'Enabled'), flag('dark-mode', 'Off')]}
      pendingKey="dark-mode"
      onAdvance={vi.fn()}
    />,
  )

  await expect.element(screen.getByRole('button', { name: 'EnableRequested' })).toBeDisabled()
  await expect.element(screen.getByRole('button', { name: 'DisableRequested' })).toBeEnabled()
})

test('an empty roster shows the no-flags copy', async () => {
  const screen = await render(<FlagList flags={[]} onAdvance={vi.fn()} />)

  await expect.element(screen.getByText('No flags resolved')).toBeVisible()
})

test('an error is announced in an alert', async () => {
  const screen = await render(
    <FlagList
      flags={[flag('donations', 'Enabled')]}
      error="Could not advance the rollout."
      onAdvance={vi.fn()}
    />,
  )

  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('Could not advance the rollout.')
})
