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
