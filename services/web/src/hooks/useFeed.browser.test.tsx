import { expect, test, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import type { ApiClient } from '../api/client'
import { useFeed } from './useFeed'

// Hook test (ADR-0027): useFeed composes the already-tested useResource; its own delta is mapping
// `listFeed(communityId).posts` into the `posts` field. We cover that delta only — a fake ApiClient
// with just `listFeed` drives the hook through `renderHook`. Browser env (component config).

test("the feed loads a community's posts on mount", async () => {
  const posts = [{ id: 'post_1' }, { id: 'post_2' }]
  const listFeed = vi.fn(async () => ({ posts }))
  const api = { listFeed } as unknown as ApiClient
  const { result } = await renderHook(() => useFeed(api, 'comm_1'))

  await vi.waitFor(() => expect(result.current.posts).toEqual(posts))
  expect(listFeed).toHaveBeenCalledWith('comm_1')
})

test('a feed load failure surfaces through error and leaves posts empty', async () => {
  const api = {
    listFeed: async () => {
      throw new Error('gateway down')
    },
  } as unknown as ApiClient
  const { result } = await renderHook(() => useFeed(api, 'comm_1'))

  await vi.waitFor(() => expect(result.current.error).toBeTruthy())
  expect(result.current.posts).toEqual([])
})
