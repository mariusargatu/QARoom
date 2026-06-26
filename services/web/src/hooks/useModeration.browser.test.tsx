import { expect, test, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import type { ApiClient } from '../api/client'
import { useModeration } from './useModeration'

// Hook test (ADR-0027): useModeration composes the already-tested useResource; its own delta is
// mapping `listModerationDecisions(communityId).decisions` into the `decisions` field. A fake
// ApiClient with just that one read method drives the hook through `renderHook`.

test('moderation decisions load on mount for a community', async () => {
  const decisions = [{ id: 'dec_1' }, { id: 'dec_2' }]
  const listModerationDecisions = vi.fn(async () => ({ decisions }))
  const api = { listModerationDecisions } as unknown as ApiClient
  const { result } = await renderHook(() => useModeration(api, 'comm_1'))

  await vi.waitFor(() => expect(result.current.decisions).toEqual(decisions))
  expect(listModerationDecisions).toHaveBeenCalledWith('comm_1')
})

test('a moderation load failure surfaces through error and leaves decisions empty', async () => {
  const api = {
    listModerationDecisions: async () => {
      throw new Error('moderator unavailable')
    },
  } as unknown as ApiClient
  const { result } = await renderHook(() => useModeration(api, 'comm_1'))

  await vi.waitFor(() => expect(result.current.error).toBeTruthy())
  expect(result.current.decisions).toEqual([])
})
