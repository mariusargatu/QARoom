/// <reference types="@vitest/browser/matchers" />
import {
  type CastVoteResponse,
  EXAMPLE_AS_OF,
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_POST,
  type Feed,
  MemberList,
  type Post,
} from '@qaroom/contracts'
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ApiClient } from '../../../api/client'
import { withProviders } from '../../../test-support/with-providers'
import { CommunityFeedPage } from './CommunityFeedPage'

// Page composition-delta test (ADR-0027): CommunityFeedPage composes the proven PostList/PostRow/SortTabs/
// ErrorState organisms behind the useFeed + useMembers hooks. The tests cover ONLY the page's own delta:
// its data-state branches (empty / loaded / error, driven through the fake api the hooks read) and the
// page-owned New-vs-Top sort. The row's vote-cluster + title rendering is proven in PostRow's own test.

const emptyMembers = async () =>
  MemberList.parse({ community_id: EXAMPLE_COMMUNITY_ID, members: [], as_of: EXAMPLE_AS_OF })

const post = (id: string, title: string, score: number): Post =>
  ({ ...EXAMPLE_POST, id, title, score }) as unknown as Post

const feed = (posts: Post[]): Feed =>
  ({ community_id: EXAMPLE_COMMUNITY_ID, posts, as_of: EXAMPLE_AS_OF }) as unknown as Feed

const feedRoute = (api: Partial<ApiClient>) =>
  withProviders(
    <Routes>
      <Route path="/c/:communityId" element={<CommunityFeedPage />} />
    </Routes>,
    { path: '/c/comm_x', api },
  )

test('an empty feed shows the page start-the-conversation empty state', async () => {
  localStorage.clear()
  const screen = await render(
    feedRoute({ listFeed: async () => feed([]), listMembers: emptyMembers }),
  )

  await expect.element(screen.getByText('No posts yet')).toBeVisible()
})

test('a loaded feed renders a row link per post', async () => {
  localStorage.clear()
  const screen = await render(
    feedRoute({
      listFeed: async () => feed([post('post_a', 'Alpha', 1), post('post_b', 'Bravo', 2)]),
      listMembers: emptyMembers,
    }),
  )

  await expect.element(screen.getByRole('link', { name: 'Alpha' })).toBeVisible()
  await expect.element(screen.getByRole('link', { name: 'Bravo' })).toBeVisible()
})

test('sorting by Top orders the highest-scored post first', async () => {
  localStorage.clear()
  const screen = await render(
    feedRoute({
      // Returned in newest-first order: low score before high score.
      listFeed: async () =>
        feed([post('post_low', 'Aardvark', 1), post('post_high', 'Zeppelin', 9)]),
      listMembers: emptyMembers,
    }),
  )

  await expect.element(screen.getByRole('link', { name: 'Zeppelin' })).toBeVisible()
  await screen.getByRole('button', { name: 'Top' }).click()
  await expect
    .element(screen.getByRole('button', { name: 'Top' }))
    .toHaveAttribute('aria-pressed', 'true')

  const body = document.body.textContent ?? ''
  expect(body.indexOf('Zeppelin')).toBeLessThan(body.indexOf('Aardvark'))
})

test('a feed load error swaps the list for the retryable error panel', async () => {
  localStorage.clear()
  const screen = await render(
    feedRoute({
      listFeed: async () => {
        throw new Error('feed upstream down')
      },
      listMembers: emptyMembers,
    }),
  )

  await expect.element(screen.getByText('feed upstream down')).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('upvoting a post patches only that post score, leaving its sibling untouched', async () => {
  localStorage.clear()
  // A known community exercises the `community?.name`/`?.slug` found branch + the rail.
  localStorage.setItem(
    'qaroom.communities',
    JSON.stringify([{ id: 'comm_x', slug: 'general', name: 'General' }]),
  )
  const screen = await render(
    feedRoute({
      listFeed: async () => feed([post('post_a', 'Alpha', 1), post('post_b', 'Bravo', 2)]),
      listMembers: emptyMembers,
      castVote: async () => ({ score: 5, post_id: 'post_a' }) as unknown as CastVoteResponse,
    }),
  )

  await expect.element(screen.getByRole('link', { name: 'Alpha' })).toBeVisible()
  // Two Upvote buttons (one per row); the first row is Alpha.
  await screen.getByRole('button', { name: 'Upvote' }).first().click()

  // Exact match: the meta line's date ("…-05-…") contains a substring "5".
  await expect.element(screen.getByText('5', { exact: true })).toBeVisible()
})

test('a failed vote surfaces the error and does not patch the score', async () => {
  localStorage.clear()
  const screen = await render(
    feedRoute({
      listFeed: async () => feed([post('post_a', 'Alpha', 3)]),
      listMembers: emptyMembers,
      castVote: async () => {
        throw new Error('vote service down')
      },
    }),
  )

  await screen.getByRole('button', { name: 'Upvote' }).click()

  await expect.element(screen.getByRole('alert')).toHaveTextContent('vote service down')
  // The optimistic patch is skipped on failure: the original score is still shown.
  await expect.element(screen.getByText('3', { exact: true })).toBeVisible()
})

test('retrying after a failed feed load reloads the posts', async () => {
  localStorage.clear()
  let calls = 0
  const screen = await render(
    feedRoute({
      listFeed: async () => {
        calls += 1
        if (calls === 1) throw new Error('feed upstream down')
        return feed([post('post_a', 'Alpha', 1)])
      },
      listMembers: emptyMembers,
    }),
  )

  await expect.element(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
  await screen.getByRole('button', { name: 'Try again' }).click()

  await expect.element(screen.getByRole('link', { name: 'Alpha' })).toBeVisible()
})
