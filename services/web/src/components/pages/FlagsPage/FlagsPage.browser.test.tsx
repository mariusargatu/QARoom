/// <reference types="@vitest/browser/matchers" />
import {
  EXAMPLE_AS_OF,
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_FLAG_RESOLUTION,
  FlagList,
  FlagResolution,
} from '@qaroom/contracts'
import { Route, Routes } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { type WithProvidersOpts, withProviders } from '../../../test-support/with-providers'
import { FlagsPage } from './FlagsPage'

// Page composition-delta test (ADR-0027): FlagsPage reads the `useFlagsList` hook and either shows the
// proven ErrorState molecule OR wires the proven FlagList organism with the hook's data. The tests
// cover ONLY the page's own delta — the error-vs-content split and that the loaded/loading data flows
// into the organism — driven through the fake `ApiClient` the hook calls. The organism's per-flag
// stepper rendering is already proven in FlagList's own test and is not re-asserted here.

const flagsRoute = (api: WithProvidersOpts['api']) =>
  withProviders(
    <Routes>
      <Route path="/c/:communityId/flags" element={<FlagsPage />} />
    </Routes>,
    { path: '/c/comm_x/flags', api },
  )

test('the resolved flags flow into the flag list (the organism is wired in)', async () => {
  const screen = await render(
    flagsRoute({
      // The example flag is keyed `donations` — the one well-known key the hook would otherwise
      // resolve separately — so its presence short-circuits the merge: only `listFlags` is read.
      listFlags: async () =>
        FlagList.parse({
          community_id: EXAMPLE_COMMUNITY_ID,
          flags: [EXAMPLE_FLAG_RESOLUTION],
          as_of: EXAMPLE_AS_OF,
        }),
    }),
  )

  await expect.element(screen.getByRole('heading', { name: 'donations' })).toBeVisible()
})

test('a flags load error surfaces the retryable error panel instead of the list', async () => {
  const screen = await render(
    flagsRoute({
      listFlags: async () => {
        throw new Error('flags upstream down')
      },
    }),
  )

  await expect.element(screen.getByText('flags upstream down')).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('while the flags are loading the list region is marked busy', async () => {
  const screen = await render(flagsRoute({ listFlags: () => new Promise<FlagList>(() => {}) }))

  await expect.element(screen.getByRole('heading', { name: 'Feature flags' })).toBeVisible()
  expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
})

// The example flag is the `donations` rollout sitting Enabled, whose only legal next event is
// `DisableRequested` — so the stepper renders exactly that advance button.
const enabledFlags = async () =>
  FlagList.parse({
    community_id: EXAMPLE_COMMUNITY_ID,
    flags: [EXAMPLE_FLAG_RESOLUTION],
    as_of: EXAMPLE_AS_OF,
  })

test('advancing a flag drives the rollout transition and applies the returned state', async () => {
  const advanceRollout = vi.fn(async () =>
    FlagResolution.parse({ ...EXAMPLE_FLAG_RESOLUTION, state: 'Disabling', enabled: false }),
  )
  const screen = await render(flagsRoute({ listFlags: enabledFlags, advanceRollout }))

  await screen.getByRole('button', { name: 'DisableRequested' }).click()

  await vi.waitFor(() =>
    expect(advanceRollout).toHaveBeenCalledWith('comm_x', 'donations', 'DisableRequested'),
  )
  // The optimistic patch flowed into the list: the now-Disabling flag offers its next transition.
  await expect.element(screen.getByRole('button', { name: 'DisableCompleted' })).toBeVisible()
})

test('a failed advance surfaces the inline advance error without dropping the list', async () => {
  const advanceRollout = vi.fn(async () => {
    throw new Error('rollout locked')
  })
  const screen = await render(flagsRoute({ listFlags: enabledFlags, advanceRollout }))

  await screen.getByRole('button', { name: 'DisableRequested' }).click()

  await expect.element(screen.getByText('rollout locked')).toBeVisible()
  await expect.element(screen.getByRole('heading', { name: 'donations' })).toBeVisible()
})

test('retrying a failed flags load recovers the list', async () => {
  const listFlags = vi.fn(enabledFlags).mockRejectedValueOnce(new Error('flags offline'))
  const screen = await render(flagsRoute({ listFlags }))

  await screen.getByRole('button', { name: 'Try again' }).click()

  await expect.element(screen.getByRole('heading', { name: 'donations' })).toBeVisible()
})
