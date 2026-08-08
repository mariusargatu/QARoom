import { expect, test, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import type { ApiClient } from '../api/client'
import { useVote } from './useVote'

// Hook test (ADR-0027): the data hooks take their `ApiClient` as a parameter (dependency injection),
// so a fake api object drives them through `renderHook` — no fetch/MSW. This is the reference shape
// for every `use*` hook. Browser env (the component config runs `*.browser.test.tsx`).

test('a successful vote records the viewer choice and returns the new score', async () => {
  const castVote = vi.fn(async () => ({ score: 7, post_id: 'post_1' }))
  const api = { castVote } as unknown as ApiClient
  const { result } = await renderHook(() => useVote(api, 'voter_1'))

  const score = await result.current.vote('post_1', 1)

  expect(score).toBe(7)
  expect(castVote).toHaveBeenCalledWith('post_1', { voter_id: 'voter_1', value: 1 })
  await vi.waitFor(() => expect(result.current.myVotes.post_1).toBe(1))
})

test('a failed vote is caught into error and returns undefined (never an unhandled rejection)', async () => {
  const api = {
    castVote: async () => {
      throw new Error('gateway down')
    },
  } as unknown as ApiClient
  const { result } = await renderHook(() => useVote(api, 'voter_1'))

  const score = await result.current.vote('post_1', -1)

  expect(score).toBeUndefined()
  await vi.waitFor(() => expect(result.current.error).toBeTruthy())
})

// Pending and error used to be a single `pendingId` / `error` pair shared by every post. Voting on A
// then B before A settled meant A's completion cleared B's pending flag — B's row re-enabled its
// buttons mid-flight, inviting a duplicate cast — and each new vote wiped the previous failure
// message before it could be read. Both are per-post now, so concurrent casts cannot interfere.
test('a settled vote does not clear a different post still in flight', async () => {
  const settle: Record<string, (score: number) => void> = {}
  const api = {
    castVote: (postId: string) =>
      new Promise((resolve) => {
        settle[postId] = (score: number) => resolve({ score, post_id: postId })
      }),
  } as unknown as ApiClient
  const { result } = await renderHook(() => useVote(api, 'voter_1'))

  void result.current.vote('post_a', 1)
  void result.current.vote('post_b', 1)
  await vi.waitFor(() => {
    expect(result.current.isPending('post_a')).toBe(true)
    expect(result.current.isPending('post_b')).toBe(true)
  })

  settle.post_a?.(7)

  await vi.waitFor(() => expect(result.current.isPending('post_a')).toBe(false))
  expect(result.current.isPending('post_b')).toBe(true)
  settle.post_b?.(3)
})

test('one post failing leaves another post failure message intact', async () => {
  const api = {
    castVote: async (postId: string) => {
      throw new Error(`${postId} failed`)
    },
  } as unknown as ApiClient
  const { result } = await renderHook(() => useVote(api, 'voter_1'))

  await result.current.vote('post_a', 1)
  await result.current.vote('post_b', 1)

  await vi.waitFor(() => {
    expect(result.current.errors.post_a).toBe('post_a failed')
    expect(result.current.errors.post_b).toBe('post_b failed')
  })
})
