/// <reference types="@vitest/browser/matchers" />
import { type CastVoteResponse, EXAMPLE_POST, type Post } from '@qaroom/contracts'
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ApiClient } from '../../../api/client'
import { withProviders } from '../../../test-support/with-providers'
import { PostDetailPage } from './PostDetailPage'

// Page composition-delta test (ADR-0027): PostDetailPage composes the already-proven VoteControl
// molecule + usePost/useVote hooks. The test covers only the page's own delta — its data-state
// branches (loading / loaded / error, driven through the fake api the hooks read), that the vote
// control organism is wired in, and the back-to-feed chrome. VoteControl/usePost internals are not
// re-asserted (they own their tests).

const PATH = '/c/comm_xyz/p/post_1'

const routed = (api: Partial<ApiClient>) =>
  withProviders(
    <Routes>
      <Route path="/c/:communityId/p/:postId" element={<PostDetailPage />} />
    </Routes>,
    { api, path: PATH },
  )

test('a loaded post renders its title and wires in the vote control', async () => {
  const screen = await render(routed({ getPost: async () => EXAMPLE_POST as unknown as Post }))

  await expect.element(screen.getByRole('heading', { name: EXAMPLE_POST.title })).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Upvote' })).toBeVisible()
})

test('a failed load shows the error state instead of the post', async () => {
  const screen = await render(
    routed({
      getPost: async () => {
        throw new Error('boom')
      },
    }),
  )

  await expect.element(screen.getByText('Something went wrong')).toBeVisible()
  await expect.element(screen.getByText('boom')).toBeVisible()
})

test('while the post is loading the page shows skeleton placeholders', async () => {
  const screen = await render(routed({ getPost: () => new Promise<Post>(() => {}) }))

  await expect
    .element(screen.getByRole('heading', { name: EXAMPLE_POST.title }))
    .not.toBeInTheDocument()
  expect(document.querySelector('.animate-pulse')).not.toBeNull()
})

test('the page links back to its community feed', async () => {
  const screen = await render(routed({ getPost: async () => EXAMPLE_POST as unknown as Post }))

  await expect
    .element(screen.getByRole('link', { name: '← Back to feed' }))
    .toHaveAttribute('href', '/c/comm_xyz')
})

test('upvoting the post optimistically patches its score from the cast response', async () => {
  const screen = await render(
    routed({
      getPost: async () => EXAMPLE_POST as unknown as Post,
      castVote: async () => ({ score: 9, post_id: EXAMPLE_POST.id }) as unknown as CastVoteResponse,
    }),
  )

  await expect.element(screen.getByRole('heading', { name: EXAMPLE_POST.title })).toBeVisible()
  await screen.getByRole('button', { name: 'Upvote' }).click()

  await expect.element(screen.getByText('9', { exact: true })).toBeVisible()
})

test('retrying after a failed load reloads the post', async () => {
  let calls = 0
  const screen = await render(
    routed({
      getPost: async () => {
        calls += 1
        if (calls === 1) throw new Error('boom')
        return EXAMPLE_POST as unknown as Post
      },
    }),
  )

  await expect.element(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
  await screen.getByRole('button', { name: 'Try again' }).click()

  await expect.element(screen.getByRole('heading', { name: EXAMPLE_POST.title })).toBeVisible()
})

test('a failed vote surfaces the error and leaves the score unpatched', async () => {
  const screen = await render(
    routed({
      getPost: async () => ({ ...EXAMPLE_POST, score: 4 }) as unknown as Post,
      castVote: async () => {
        throw new Error('vote service down')
      },
    }),
  )

  await expect.element(screen.getByRole('heading', { name: EXAMPLE_POST.title })).toBeVisible()
  await screen.getByRole('button', { name: 'Upvote' }).click()

  await expect.element(screen.getByRole('alert')).toHaveTextContent('vote service down')
  await expect.element(screen.getByText('4', { exact: true })).toBeVisible()
})

test('a resolved-but-missing post shows the not-found error state', async () => {
  const screen = await render(routed({ getPost: async () => null as unknown as Post }))

  await expect.element(screen.getByText('Post not found.')).toBeVisible()
})

test('a post with no body renders the no-body placeholder', async () => {
  const screen = await render(
    routed({ getPost: async () => ({ ...EXAMPLE_POST, body: '' }) as unknown as Post }),
  )

  await expect.element(screen.getByText('No body.')).toBeVisible()
})
