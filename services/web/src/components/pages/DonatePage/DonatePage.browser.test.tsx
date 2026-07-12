/// <reference types="@vitest/browser/matchers" />
import {
  type Donation,
  DonationList,
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_DONATION,
  EXAMPLE_FLAG_RESOLUTION,
  EXAMPLE_USER_ID,
  FlagResolution,
} from '@qaroom/contracts'
import { TESTID } from '@qaroom/testing-utils/testids'
import { Route, Routes } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ApiClient } from '../../../api/client'
import { withProviders } from '../../../test-support/with-providers'
import { DonatePage } from './DonatePage'

// Page composition-delta test (ADR-0027): DonatePage gates the proven DonationForm + DonationList
// organisms on the donations rollout (via useRollout) and feeds the history from useDonations. The
// tests cover ONLY the page's own delta: the rollout gate (its own "rollout state" copy + passing
// `enabled` down to ungate the form) and that loaded donations flow into the list. The form's amount
// field and the list's row formatting are proven in their own tests and not re-asserted here.

const resolveFlagTo = (state: string, enabled: boolean) => async () =>
  FlagResolution.parse({ ...EXAMPLE_FLAG_RESOLUTION, state, enabled })

const donations = (rows: unknown[]) => async () =>
  DonationList.parse({ community_id: EXAMPLE_COMMUNITY_ID, donations: rows })

const donateRoute = (api: Partial<ApiClient>) =>
  withProviders(
    <Routes>
      <Route path="/c/:communityId/donate" element={<DonatePage />} />
    </Routes>,
    { path: '/c/comm_x/donate', api },
  )

test('a community without the donations rollout shows the page not-enabled gate', async () => {
  localStorage.clear()
  const screen = await render(
    donateRoute({ resolveFlag: resolveFlagTo('Off', false), listDonations: donations([]) }),
  )

  await expect.element(screen.getByText('rollout state: Off', { exact: false })).toBeVisible()
})

test('an enabled rollout ungates the donation form', async () => {
  localStorage.clear()
  const screen = await render(
    donateRoute({ resolveFlag: resolveFlagTo('Enabled', true), listDonations: donations([]) }),
  )

  await expect.element(screen.getByTestId(TESTID.donationAmount)).toBeVisible()
})

test('loaded donations from the gateway appear in the history', async () => {
  localStorage.clear()
  const screen = await render(
    donateRoute({
      resolveFlag: resolveFlagTo('Off', false),
      listDonations: donations([EXAMPLE_DONATION]),
    }),
  )

  await expect.element(screen.getByText('$25.00')).toBeVisible()
})

const signInAs = (id: string) =>
  localStorage.setItem(
    'qaroom.session',
    JSON.stringify({
      token: 'header.payload.sig',
      currentUser: { id, handle: 'ada', display_name: 'Ada' },
    }),
  )

test('a signed-in donor submitting the enabled form captures a donation with their id', async () => {
  localStorage.clear()
  signInAs(EXAMPLE_USER_ID)
  const createDonation = vi.fn(async () => EXAMPLE_DONATION as unknown as Donation)
  const screen = await render(
    donateRoute({
      resolveFlag: resolveFlagTo('Enabled', true),
      listDonations: donations([]),
      createDonation,
    }),
  )

  await screen.getByTestId(TESTID.donationSubmit).click()

  await vi.waitFor(() =>
    expect(createDonation).toHaveBeenCalledWith('comm_x', {
      donor_id: EXAMPLE_USER_ID,
      amount_cents: 2500,
      currency: 'USD',
    }),
  )
})

test('a signed-out visitor submitting the enabled form captures nothing (no donor)', async () => {
  localStorage.clear()
  const createDonation = vi.fn(async () => EXAMPLE_DONATION as unknown as Donation)
  const screen = await render(
    donateRoute({
      resolveFlag: resolveFlagTo('Enabled', true),
      listDonations: donations([]),
      createDonation,
    }),
  )

  await screen.getByTestId(TESTID.donationSubmit).click()

  expect(createDonation).not.toHaveBeenCalled()
})

test('a declined donation surfaces the donation error', async () => {
  localStorage.clear()
  signInAs(EXAMPLE_USER_ID)
  const createDonation = vi.fn(async () => {
    throw new Error('card declined')
  })
  const screen = await render(
    donateRoute({
      resolveFlag: resolveFlagTo('Enabled', true),
      listDonations: donations([]),
      createDonation,
    }),
  )

  await screen.getByTestId(TESTID.donationSubmit).click()

  await expect.element(screen.getByText('card declined')).toBeVisible()
})
