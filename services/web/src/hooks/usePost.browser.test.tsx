import type { Post } from '@qaroom/contracts'
import { expect, test, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import type { ApiClient } from '../api/client'
import { usePost } from './usePost'

// Hook test (ADR-0027): usePost composes the shared useResource but adds two behaviors of its own —
// it loads a single post by id (getPost wiring), and it re-exposes the cache setter as `setPost` so a
// vote can patch the score in place WITHOUT a refetch. We cover those deltas with a fake ApiClient;
// the plain useResource load/error/race path is already proven by useResource's own test.

const makePost = (score: number): Post =>
  ({
    id: 'post_01HZY',
    community_id: 'comm_01HZY',
    author_id: 'user_01HZY',
    title: 'Hello',
    body: 'world',
    score,
    created_at: '2026-01-01T00:00:00.000Z',
  }) as unknown as Post

test('loads the post for the given id on mount', async () => {
  const getPost = vi.fn(async () => makePost(3))
  const api = { getPost } as unknown as ApiClient
  const { result } = await renderHook(() => usePost(api, 'post_01HZY'))

  await vi.waitFor(() => expect(result.current.post?.score).toBe(3))
  expect(getPost).toHaveBeenCalledWith('post_01HZY')
})

test('setPost patches the cached post in place without refetching it', async () => {
  const getPost = vi.fn(async () => makePost(3))
  const api = { getPost } as unknown as ApiClient
  const { result } = await renderHook(() => usePost(api, 'post_01HZY'))

  await vi.waitFor(() => expect(result.current.post?.score).toBe(3))
  const loadsBefore = getPost.mock.calls.length
  result.current.setPost(makePost(99))

  await vi.waitFor(() => expect(result.current.post?.score).toBe(99))
  expect(getPost.mock.calls.length).toBe(loadsBefore)
})
