/// <reference types="@vitest/browser/matchers" />
import {
  type AccessTokenResponse,
  type Community,
  EXAMPLE_COMMUNITY,
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_HANDLE,
  EXAMPLE_USER_ID,
  type Membership,
} from '@qaroom/contracts'
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ApiClient } from '../../../api/client'
import { withProviders } from '../../../test-support/with-providers'
import { CommunitiesPage } from './CommunitiesPage'

const signIn = () =>
  localStorage.setItem(
    'qaroom.session',
    JSON.stringify({
      token: 'header.payload.sig',
      currentUser: { id: EXAMPLE_USER_ID, handle: EXAMPLE_HANDLE, display_name: 'Ada Lovelace' },
    }),
  )

const createdCommunity = () => EXAMPLE_COMMUNITY as unknown as Community
const token = () => ({ access_token: 'header.payload.sig' }) as unknown as AccessTokenResponse
const membership = () => EXAMPLE_COMMUNITY as unknown as Membership

const communitiesRoute = (api: Partial<ApiClient>) =>
  withProviders(
    <Routes>
      <Route path="/" element={<CommunitiesPage />} />
      <Route path="/c/:communityId" element={<div data-testid="screen">feed</div>} />
    </Routes>,
    { api },
  )

// Page composition-delta test (ADR-0027): CommunitiesPage reads the session's known-communities roster
// (localStorage-backed, no list endpoint) and composes proven FormField/Input/Button atoms into a
// create form. The tests cover ONLY the page's own delta: the empty-vs-populated roster branch, that a
// known community renders as a navigable link, and the page's create-button gating (disabled until both
// fields are non-empty). The atoms' internals are proven in their own tests and not re-asserted here.

test('an empty roster shows the page no-communities-yet state', async () => {
  localStorage.clear()
  const screen = await render(withProviders(<CommunitiesPage />))

  await expect.element(screen.getByText('No communities yet')).toBeVisible()
})

test('a known community renders as a link to its feed', async () => {
  localStorage.clear()
  localStorage.setItem(
    'qaroom.communities',
    JSON.stringify([{ id: EXAMPLE_COMMUNITY_ID, slug: 'general', name: 'General' }]),
  )
  const screen = await render(withProviders(<CommunitiesPage />))

  await expect
    .element(screen.getByRole('link', { name: 'General' }))
    .toHaveAttribute('href', `/c/${EXAMPLE_COMMUNITY_ID}`)
})

test('the create button is disabled until a slug and name are entered', async () => {
  localStorage.clear()
  const screen = await render(withProviders(<CommunitiesPage />))

  await expect.element(screen.getByRole('button', { name: 'Create community' })).toBeDisabled()
})

test('filling the slug and name enables the create button', async () => {
  localStorage.clear()
  const screen = await render(withProviders(<CommunitiesPage />))

  await screen.getByRole('textbox', { name: /Slug/ }).fill('myslug')
  await screen.getByRole('textbox', { name: /Name/ }).fill('My Community')

  await expect.element(screen.getByRole('button', { name: 'Create community' })).toBeEnabled()
})

test('submitting the form creates the community, owns it, and navigates to its feed', async () => {
  localStorage.clear()
  signIn()
  const screen = await render(
    communitiesRoute({
      createCommunity: async () => createdCommunity(),
      addMembership: async () => membership(),
      createSession: async () => token(),
    }),
  )

  await screen.getByRole('textbox', { name: /Slug/ }).fill('general')
  await screen.getByRole('textbox', { name: /Name/ }).fill('General')
  await screen.getByRole('button', { name: 'Create community' }).click()

  await expect.element(screen.getByTestId('screen')).toHaveTextContent('feed')
})

test('a failed create surfaces the error and stays on the page', async () => {
  localStorage.clear()
  signIn()
  const screen = await render(
    communitiesRoute({
      createCommunity: async () => {
        throw new Error('slug already in use')
      },
    }),
  )

  await screen.getByRole('textbox', { name: /Slug/ }).fill('general')
  await screen.getByRole('textbox', { name: /Name/ }).fill('General')
  await screen.getByRole('button', { name: 'Create community' }).click()

  await expect.element(screen.getByRole('alert')).toHaveTextContent('slug already in use')
  await expect.element(screen.getByTestId('screen')).not.toBeInTheDocument()
})

// The submit button is disabled until both fields are present, so a click/Enter never reaches the
// onSubmit `if (slug && name && !pending)` re-check invalid — it only defends a PROGRAMMATIC submit.
// Dispatching a submit with an empty slug (then an empty name) drives that defended false arm: the
// guard short-circuits and create() is never called.
test('a programmatic submit with a missing field does not create (the validity guard holds)', async () => {
  localStorage.clear()
  signIn()
  let createCalls = 0
  const screen = await render(
    communitiesRoute({
      createCommunity: async () => {
        createCalls += 1
        return createdCommunity()
      },
    }),
  )
  const submit = () =>
    (document.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )

  // name present, slug empty -> slug.trim() is falsy, the && chain short-circuits to false.
  await screen.getByRole('textbox', { name: /Name/ }).fill('General')
  submit()
  // slug present, name empty -> name.trim() is falsy.
  await screen.getByRole('textbox', { name: /Name/ }).fill('')
  await screen.getByRole('textbox', { name: /Slug/ }).fill('general')
  submit()

  expect(createCalls).toBe(0)
})

test('submitting without a signed-in identity is a no-op (no create, no navigation)', async () => {
  localStorage.clear()
  const screen = await render(
    communitiesRoute({
      createCommunity: async () => {
        throw new Error('createCommunity must not be called without a current user')
      },
    }),
  )

  await screen.getByRole('textbox', { name: /Slug/ }).fill('general')
  await screen.getByRole('textbox', { name: /Name/ }).fill('General')
  await screen.getByRole('button', { name: 'Create community' }).click()

  await expect.element(screen.getByTestId('screen')).not.toBeInTheDocument()
  await expect.element(screen.getByRole('heading', { name: 'Communities' })).toBeVisible()
})
