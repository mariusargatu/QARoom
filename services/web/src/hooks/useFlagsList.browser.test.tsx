import { expect, test, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import type { ApiClient } from '../api/client'
import { useFlagsList } from './useFlagsList'

// Hook test (ADR-0027): useFlagsList composes the shared useResource but adds two behaviors of its
// own — it back-fills the well-known `donations` flag the listing omits (resolveFlag merge), and it
// advances a flag's rollout, patching the single result in place. We cover those deltas with a fake
// ApiClient; the plain useResource load/error path is already proven by useResource's own test.

const donationsOff = { flag_key: 'donations', stage: 'off' }
const donationsOn = { flag_key: 'donations', stage: 'on' }

test('the list back-fills a known flag the listing omits via resolveFlag', async () => {
  const listFlags = vi.fn(async () => ({ flags: [] }))
  const resolveFlag = vi.fn(async () => donationsOff)
  const api = { listFlags, resolveFlag } as unknown as ApiClient
  const { result } = await renderHook(() => useFlagsList(api, 'comm_1'))

  await vi.waitFor(() => expect(result.current.flags).toEqual([donationsOff]))
  expect(resolveFlag).toHaveBeenCalledWith('comm_1', 'donations')
})

test('a known flag already in the listing is not re-resolved', async () => {
  const listFlags = vi.fn(async () => ({ flags: [donationsOff] }))
  const resolveFlag = vi.fn(async () => donationsOff)
  const api = { listFlags, resolveFlag } as unknown as ApiClient
  const { result } = await renderHook(() => useFlagsList(api, 'comm_1'))

  await vi.waitFor(() => expect(result.current.flags).toEqual([donationsOff]))
  expect(resolveFlag).not.toHaveBeenCalled()
})

test('advance patches the advanced flag in place from the rollout result', async () => {
  const listFlags = vi.fn(async () => ({ flags: [donationsOff] }))
  const resolveFlag = vi.fn(async () => donationsOff)
  const advanceRollout = vi.fn(async () => donationsOn)
  const api = { listFlags, resolveFlag, advanceRollout } as unknown as ApiClient
  const { result } = await renderHook(() => useFlagsList(api, 'comm_1'))

  await vi.waitFor(() => expect(result.current.flags).toEqual([donationsOff]))
  await result.current.advance('donations', 'EnableRequested')

  expect(advanceRollout).toHaveBeenCalledWith('comm_1', 'donations', 'EnableRequested')
  await vi.waitFor(() => expect(result.current.flags).toEqual([donationsOn]))
  expect(result.current.pendingKey).toBeUndefined()
})

test('advance patches only the matching flag and leaves the others untouched', async () => {
  // Two flags present; advancing `donations` must rewrite only that row (the `f.flag_key === flagKey`
  // true arm) while the non-matching `comments` row is returned unchanged (the ternary false arm).
  const comments = { flag_key: 'comments', stage: 'on' }
  const listFlags = vi.fn(async () => ({ flags: [comments, donationsOff] }))
  const resolveFlag = vi.fn(async () => donationsOff)
  const advanceRollout = vi.fn(async () => donationsOn)
  const api = { listFlags, resolveFlag, advanceRollout } as unknown as ApiClient
  const { result } = await renderHook(() => useFlagsList(api, 'comm_1'))

  await vi.waitFor(() => expect(result.current.flags).toEqual([comments, donationsOff]))
  await result.current.advance('donations', 'EnableRequested')

  await vi.waitFor(() => expect(result.current.flags).toEqual([comments, donationsOn]))
  expect(resolveFlag).not.toHaveBeenCalled() // donations already listed -> no back-fill
})

test('an advance failure surfaces through advanceError and clears the pending key', async () => {
  const listFlags = vi.fn(async () => ({ flags: [donationsOff] }))
  const resolveFlag = vi.fn(async () => donationsOff)
  const advanceRollout = async () => {
    throw new Error('illegal transition')
  }
  const api = { listFlags, resolveFlag, advanceRollout } as unknown as ApiClient
  const { result } = await renderHook(() => useFlagsList(api, 'comm_1'))

  await vi.waitFor(() => expect(result.current.flags).toEqual([donationsOff]))
  await result.current.advance('donations', 'EnableRequested')

  await vi.waitFor(() => expect(result.current.advanceError).toBeTruthy())
  expect(result.current.pendingKey).toBeUndefined()
})
