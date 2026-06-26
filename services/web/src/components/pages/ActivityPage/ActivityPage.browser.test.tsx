/// <reference types="@vitest/browser/matchers" />
import { EventPage, EXAMPLE_COMMUNITY_ID, EXAMPLE_WHEN } from '@qaroom/contracts'
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ApiClient } from '../../../api/client'
import { withProviders } from '../../../test-support/with-providers'
import { ActivityPage } from './ActivityPage'

// Page composition-delta test (ADR-0027): ActivityPage composes the proven NotificationFeed organism
// fed by the WS-with-polling-fallback hook. Signed out (no token), the WS connector is absent, so the
// hook polls `listEvents` only — a deterministic, socket-free seam. The tests cover ONLY the page's
// own delta: its "Activity" heading and that the polled events flow into the organism. The feed's
// per-envelope rendering is proven in NotificationFeed's own test and is not re-asserted here.

const activityRoute = (api: Partial<ApiClient>) =>
  withProviders(
    <Routes>
      <Route path="/c/:communityId/activity" element={<ActivityPage />} />
    </Routes>,
    { path: '/c/comm_x/activity', api },
  )

test('the page shows its Activity heading and the empty feed when nothing has happened', async () => {
  localStorage.clear()
  const screen = await render(
    activityRoute({
      listEvents: async () =>
        EventPage.parse({ community_id: EXAMPLE_COMMUNITY_ID, events: [], cursor: 0 }),
    }),
  )

  await expect.element(screen.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible()
  await expect.element(screen.getByText('No activity yet.')).toBeVisible()
})

test('polled events from the gateway surface in the activity feed (the organism is wired in)', async () => {
  localStorage.clear()
  const screen = await render(
    activityRoute({
      listEvents: async () =>
        EventPage.parse({
          community_id: EXAMPLE_COMMUNITY_ID,
          events: [
            {
              type: 'flag.state.changed',
              seq: 1,
              community_id: EXAMPLE_COMMUNITY_ID,
              occurred_at: EXAMPLE_WHEN,
              flag_key: 'donations',
              state: 'Enabled',
              enabled: true,
            },
          ],
          cursor: 1,
        }),
    }),
  )

  await expect.element(screen.getByText('Flag "donations"', { exact: false })).toBeVisible()
})
