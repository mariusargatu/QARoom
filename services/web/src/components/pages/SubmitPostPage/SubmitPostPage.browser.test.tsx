/// <reference types="@vitest/browser/matchers" />
import { EXAMPLE_POST, EXAMPLE_USER_ID, type Post } from '@qaroom/contracts'
import { Route, Routes } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ApiClient } from '../../../api/client'
import { withProviders } from '../../../test-support/with-providers'
import { SubmitPostPage } from './SubmitPostPage'

// Page composition-delta test (ADR-0027): SubmitPostPage composes the proven PostComposer organism.
// Its own delta is the submit orchestration — guard on a signed-in user, call createPost with the
// author id, then navigate to the new post (or surface the error). PostComposer's own validation
// gating is proven by its test; here we drive it only to trigger the page's wiring.

const PATH = '/c/comm_test/submit'

const routed = (api: Partial<ApiClient>) =>
  withProviders(
    <Routes>
      <Route path="/c/:communityId/submit" element={<SubmitPostPage />} />
      <Route
        path="/c/:communityId/p/:postId"
        element={<div data-testid="screen">post detail</div>}
      />
    </Routes>,
    { api, path: PATH },
  )

function seedSession() {
  localStorage.setItem(
    'qaroom.session',
    JSON.stringify({
      token: 'header.payload.sig',
      currentUser: { id: EXAMPLE_USER_ID, handle: 'ada', display_name: 'Ada Lovelace' },
    }),
  )
}

test('the page shows the compose heading and wires in the composer', async () => {
  localStorage.clear()
  const screen = await render(routed({}))

  await expect.element(screen.getByRole('heading', { name: 'Create a post' })).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Post' })).toBeVisible()
})

test('a signed-in user submitting a post creates it then navigates to the new post', async () => {
  localStorage.clear()
  seedSession()
  const createPost = vi.fn(async () => EXAMPLE_POST as unknown as Post)
  const screen = await render(routed({ createPost }))

  await screen.getByPlaceholder('An interesting title').fill('My great post')
  await screen.getByRole('button', { name: 'Post' }).click()

  await expect.element(screen.getByTestId('screen')).toHaveTextContent('post detail')
  expect(createPost).toHaveBeenCalledWith('comm_test', {
    author_id: EXAMPLE_USER_ID,
    title: 'My great post',
    body: '',
  })
})

test('without a signed-in user submitting never calls createPost', async () => {
  localStorage.clear()
  const createPost = vi.fn(async () => EXAMPLE_POST as unknown as Post)
  const screen = await render(routed({ createPost }))

  await screen.getByPlaceholder('An interesting title').fill('Anon post')
  await screen.getByRole('button', { name: 'Post' }).click()

  expect(createPost).not.toHaveBeenCalled()
})

test('a failed create surfaces the error and does not navigate', async () => {
  localStorage.clear()
  seedSession()
  const createPost = async () => {
    throw new Error('title is too short')
  }
  const screen = await render(routed({ createPost }))

  await screen.getByPlaceholder('An interesting title').fill('Bad post')
  await screen.getByRole('button', { name: 'Post' }).click()

  await expect.element(screen.getByText('title is too short')).toBeVisible()
  await expect.element(screen.getByTestId('screen')).not.toBeInTheDocument()
})
