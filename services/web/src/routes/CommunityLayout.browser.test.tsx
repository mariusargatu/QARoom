/// <reference types="@vitest/browser/matchers" />
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { withProviders } from '../test-support/with-providers'
import { CommunityLayout } from './CommunityLayout'

// Route-layout composition-delta test (ADR-0027): CommunityLayout resolves the `:communityId` param
// against the session roster to title the page, renders the already-proven CommunityTabs, and shows
// the routed sub-page via `<Outlet>`. Tests cover only the wrapper's delta — the name/slug resolution
// (known vs unknown community) and that the outlet renders — not CommunityTabs' internals.

function harness(communityId: string) {
  localStorage.setItem(
    'qaroom.session',
    JSON.stringify({
      token: 'header.payload.sig',
      currentUser: { id: 'user_01HZY0K7M3QF8VN2J5RX9TB4CF', handle: 'ada', display_name: 'Ada' },
    }),
  )
  // knownCommunities is backed by a SEPARATE localStorage key (qaroom.communities), not the session.
  localStorage.setItem(
    'qaroom.communities',
    JSON.stringify([{ id: 'comm_known', slug: 'general', name: 'General Chat' }]),
  )
  return withProviders(
    <Routes>
      <Route path="/c/:communityId" element={<CommunityLayout />}>
        <Route index element={<div data-testid="outlet">feed</div>} />
      </Route>
    </Routes>,
    { path: `/c/${communityId}` },
  )
}

test('a known community is titled by its name and slug', async () => {
  const screen = await render(harness('comm_known'))

  await expect.element(screen.getByRole('heading', { name: 'General Chat' })).toBeVisible()
  await expect.element(screen.getByTestId('outlet')).toHaveTextContent('feed')
})

test('an unknown community falls back to a generic title without crashing', async () => {
  const screen = await render(harness('comm_missing'))

  await expect.element(screen.getByRole('heading', { name: 'Community' })).toBeVisible()
})
