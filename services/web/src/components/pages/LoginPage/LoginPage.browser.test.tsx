/// <reference types="@vitest/browser/matchers" />

import {
  type AccessTokenResponse,
  EXAMPLE_HANDLE,
  EXAMPLE_USER_ID,
  type User,
} from '@qaroom/contracts'
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ApiClient } from '../../../api/client'
import { withProviders } from '../../../test-support/with-providers'
import { LoginPage } from './LoginPage'

const token = () => ({ access_token: 'header.payload.sig' }) as unknown as AccessTokenResponse
const newUser = () =>
  ({ id: EXAMPLE_USER_ID, handle: EXAMPLE_HANDLE, display_name: 'Ada Lovelace' }) as unknown as User

const loginRoute = (api: Partial<ApiClient>) =>
  withProviders(
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/communities" element={<div data-testid="screen">communities</div>} />
    </Routes>,
    { api },
  )

// Page composition-delta test (ADR-0027): LoginPage composes the already-proven IdentityPicker
// organism + CenteredShell template. The test covers ONLY the page's own delta — the session-gated
// redirect and that it wires the picker in — not the picker's internals. Reference shape for page
// tests: render inside `withProviders` (session + router), assert the page-level behavior.

test('an already-signed-in visitor is redirected away from the login page', async () => {
  localStorage.setItem(
    'qaroom.session',
    JSON.stringify({
      token: 'header.payload.sig',
      currentUser: { id: 'user_01HZY0K7M3QF8VN2J5RX9TB4CF', handle: 'ada', display_name: 'Ada' },
    }),
  )
  const screen = await render(
    withProviders(
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/communities" element={<div data-testid="screen">communities</div>} />
      </Routes>,
    ),
  )

  await expect.element(screen.getByTestId('screen')).toHaveTextContent('communities')
})

test('a signed-out visitor sees the identity picker (the organism is wired in)', async () => {
  localStorage.removeItem('qaroom.session')
  const screen = await render(
    withProviders(
      <Routes>
        <Route path="/" element={<LoginPage />} />
      </Routes>,
    ),
  )

  // The picker's heading proves the page rendered the organism rather than redirecting.
  await expect.element(screen.getByRole('heading', { name: 'Welcome to QARoom' })).toBeVisible()
})

test('picking a remembered identity signs in and navigates to communities', async () => {
  localStorage.clear()
  localStorage.setItem(
    'qaroom.users',
    JSON.stringify([{ id: EXAMPLE_USER_ID, handle: EXAMPLE_HANDLE, display_name: 'Ada Lovelace' }]),
  )
  const screen = await render(loginRoute({ createSession: async () => token() }))

  await screen.getByRole('button', { name: /Ada Lovelace/ }).click()

  await expect.element(screen.getByTestId('screen')).toHaveTextContent('communities')
})

test('creating a new identity signs up and navigates to communities', async () => {
  localStorage.clear()
  const screen = await render(
    loginRoute({ createUser: async () => newUser(), createSession: async () => token() }),
  )

  await screen.getByRole('textbox', { name: /Handle/ }).fill('ada')
  await screen.getByRole('textbox', { name: /Display name/ }).fill('Ada Lovelace')
  await screen.getByRole('button', { name: 'Enter' }).click()

  await expect.element(screen.getByTestId('screen')).toHaveTextContent('communities')
})

test('a failed sign-up surfaces the error in the picker and stays on the login page', async () => {
  localStorage.clear()
  const screen = await render(
    loginRoute({
      createUser: async () => {
        throw new Error('handle already taken')
      },
    }),
  )

  await screen.getByRole('textbox', { name: /Handle/ }).fill('ada')
  await screen.getByRole('textbox', { name: /Display name/ }).fill('Ada Lovelace')
  await screen.getByRole('button', { name: 'Enter' }).click()

  await expect.element(screen.getByRole('alert')).toHaveTextContent('handle already taken')
  await expect.element(screen.getByTestId('screen')).not.toBeInTheDocument()
})
