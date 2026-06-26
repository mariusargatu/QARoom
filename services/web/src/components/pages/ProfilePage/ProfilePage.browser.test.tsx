/// <reference types="@vitest/browser/matchers" />
import { EXAMPLE_COMMUNITY_ID, EXAMPLE_USER, EXAMPLE_USER_ID, type User } from '@qaroom/contracts'
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ApiClient } from '../../../api/client'
import { withProviders } from '../../../test-support/with-providers'
import { ProfilePage } from './ProfilePage'

// Page composition-delta test (ADR-0027): ProfilePage composes the proven Avatar/Badge atoms +
// ErrorState molecule + useResource. Its own delta is the user load (loading / loaded / error
// branches) and the self-vs-other gate: only your OWN profile shows the "Your memberships" section.
// Those are covered; the child atoms' internals are not.

const routed = (api: Partial<ApiClient>, path: string) =>
  withProviders(
    <Routes>
      <Route path="/u/:userId" element={<ProfilePage />} />
    </Routes>,
    { api, path },
  )

function seedSession(userId: string, token = 'header.payload.sig') {
  localStorage.setItem(
    'qaroom.session',
    JSON.stringify({
      token,
      currentUser: { id: userId, handle: 'ada', display_name: 'Ada Lovelace' },
    }),
  )
}

// A second valid community id NOT in the seeded roster — `nameFor` must fall back to the raw id.
const UNROSTERED_COMMUNITY_ID = 'comm_0000000000000000000000000B'

// Forge a `header.payload.sig` access token carrying the given memberships. Only the middle segment
// is read (the UI decodes, never verifies — ADR-0022), base64url-encoded as a real issuer would.
// btoa is the browser runtime's encoder; the component suite runs in real Chromium.
function tokenWithMemberships(
  memberships: ReadonlyArray<{ community_id: string; role: string }>,
): string {
  const payload = { sub: EXAMPLE_USER_ID, iss: 'x', iat: 1, exp: 2, memberships }
  const segment = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return ['hdr', segment, 'sig'].join('.')
}

test("another user's profile shows their identity and not the memberships section", async () => {
  localStorage.clear()
  const screen = await render(
    routed({ getUser: async () => EXAMPLE_USER as unknown as User }, `/u/${EXAMPLE_USER_ID}`),
  )

  await expect.element(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible()
  await expect.element(screen.getByText('@ada')).toBeVisible()
  await expect.element(screen.getByText('Your memberships')).not.toBeInTheDocument()
})

test('your own profile adds the memberships section', async () => {
  localStorage.clear()
  seedSession(EXAMPLE_USER_ID)
  const screen = await render(
    routed({ getUser: async () => EXAMPLE_USER as unknown as User }, `/u/${EXAMPLE_USER_ID}`),
  )

  await expect.element(screen.getByText('Your memberships')).toBeVisible()
  await expect.element(screen.getByText('No memberships yet.')).toBeVisible()
})

test('your own memberships each render a row, naming rostered communities and falling back to the id', async () => {
  localStorage.clear()
  // Roster knows only the first community by name; the second is unknown -> its raw id is shown.
  localStorage.setItem(
    'qaroom.communities',
    JSON.stringify([{ id: EXAMPLE_COMMUNITY_ID, slug: 'general', name: 'General' }]),
  )
  seedSession(
    EXAMPLE_USER_ID,
    tokenWithMemberships([
      { community_id: EXAMPLE_COMMUNITY_ID, role: 'owner' },
      { community_id: UNROSTERED_COMMUNITY_ID, role: 'member' },
    ]),
  )
  const screen = await render(
    routed({ getUser: async () => EXAMPLE_USER as unknown as User }, `/u/${EXAMPLE_USER_ID}`),
  )

  await expect.element(screen.getByText('No memberships yet.')).not.toBeInTheDocument()
  // nameFor's hit branch: the rostered community is linked by its display name.
  await expect.element(screen.getByRole('link', { name: 'General' })).toBeVisible()
  // nameFor's fallback branch: the unrostered community is linked by its raw id.
  await expect.element(screen.getByRole('link', { name: UNROSTERED_COMMUNITY_ID })).toBeVisible()
  // Each row carries its role badge (exact: 'member' would otherwise match the "memberships" heading).
  await expect.element(screen.getByText('owner', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('member', { exact: true })).toBeVisible()
})

test('a failed load shows the error state', async () => {
  localStorage.clear()
  const screen = await render(
    routed(
      {
        getUser: async () => {
          throw new Error('user gone')
        },
      },
      `/u/${EXAMPLE_USER_ID}`,
    ),
  )

  await expect.element(screen.getByText('Something went wrong')).toBeVisible()
  await expect.element(screen.getByText('user gone')).toBeVisible()
})

test('a missing user (the load resolves to null with no error) shows the not-found state', async () => {
  localStorage.clear()
  const screen = await render(
    routed({ getUser: async () => null as unknown as User }, `/u/${EXAMPLE_USER_ID}`),
  )

  // The `!user` branch falls back to the literal message rather than an upstream error string.
  await expect.element(screen.getByText('User not found.')).toBeVisible()
})

test('while the user is loading the page shows skeleton placeholders', async () => {
  localStorage.clear()
  await render(routed({ getUser: () => new Promise<User>(() => {}) }, `/u/${EXAMPLE_USER_ID}`))

  expect(document.querySelector('.animate-pulse')).not.toBeNull()
})
