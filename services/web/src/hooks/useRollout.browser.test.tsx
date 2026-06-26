import type { FlagState } from '@qaroom/contracts'
import { expect, test, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import type { ApiClient } from '../api/client'
import { useRollout } from './useRollout'

// Hook test (ADR-0027): useRollout owns its whole flow (it does NOT compose useResource) — it resolves
// the well-known `donations` flag on mount, derives the legal events from the SAME rollout machine the
// server drives (legalEventsFor), and advances the rollout under a `pending` lock. A fake ApiClient
// drives the hook; the legal-event set is pinned to the machine, never hand-listed.

test('resolves the donations flag for the community on mount', async () => {
  const resolveFlag = vi.fn(async () => ({ state: 'Off' }))
  const api = { resolveFlag } as unknown as ApiClient
  const { result } = await renderHook(() => useRollout(api, 'comm_1'))

  await vi.waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.state).toBe('Off')
  expect(resolveFlag).toHaveBeenCalledWith('comm_1', 'donations')
})

test('legalEvents are the machine transitions legal from the resolved state', async () => {
  const resolveFlag = vi.fn(async () => ({ state: 'Off' }))
  const api = { resolveFlag } as unknown as ApiClient
  const { result } = await renderHook(() => useRollout(api, 'comm_1'))

  await vi.waitFor(() => expect(result.current.state).toBe('Off'))
  expect(result.current.legalEvents).toEqual(['EnableRequested'])
})

test('advance applies the event and adopts the state the server returns', async () => {
  const resolveFlag = vi.fn(async () => ({ state: 'Off' }))
  const advanceRollout = vi.fn(async () => ({ state: 'Enabling' }))
  const api = { resolveFlag, advanceRollout } as unknown as ApiClient
  const { result } = await renderHook(() => useRollout(api, 'comm_1'))

  await vi.waitFor(() => expect(result.current.state).toBe('Off'))
  await result.current.advance('EnableRequested')

  expect(advanceRollout).toHaveBeenCalledWith('comm_1', 'donations', 'EnableRequested')
  await vi.waitFor(() => expect(result.current.state).toBe('Enabling'))
  expect(result.current.legalEvents).toEqual(['CanaryConfirmed', 'RolloutAborted'])
})

test('a resolveFlag that settles after the community changed never overwrites the current state', async () => {
  // Each call hands back a fresh deferred so the test controls settle order. The first (comm_1) load
  // is made stale by switching to comm_2; the current load resolves first, then the stale one late.
  // The effect-cleanup `active=false` guard must drop the stale result (the `if (active)` false arm
  // in both the `.then` and the `.finally`).
  const resolvers: Array<(r: { state: FlagState }) => void> = []
  const promises: Array<Promise<{ state: FlagState }>> = []
  const resolveFlag = vi.fn(() => {
    const p = new Promise<{ state: FlagState }>((resolve) => {
      resolvers.push(resolve)
    })
    promises.push(p)
    return p
  })
  const api = { resolveFlag } as unknown as ApiClient
  const { result, rerender } = await renderHook<{ id: string }, ReturnType<typeof useRollout>>(
    (props) => useRollout(api, props?.id ?? 'comm_1'),
    { initialProps: { id: 'comm_1' } },
  )

  await vi.waitFor(() => expect(resolvers).toHaveLength(1)) // comm_1 load in flight
  await rerender({ id: 'comm_2' }) // cleanup marks comm_1 stale; comm_2 load starts
  await vi.waitFor(() => expect(resolvers).toHaveLength(2))

  resolvers[1]?.({ state: 'Canary' }) // the current (comm_2) load resolves first and wins
  await vi.waitFor(() => expect(result.current.state).toBe('Canary'))
  expect(result.current.loading).toBe(false)

  resolvers[0]?.({ state: 'Enabled' }) // the stale (comm_1) load resolves late — guard must drop it
  await promises[0] // hook's `.then`/`.finally` (registered first) run before this continuation
  // Two no-op rerenders (same deps -> no new load) force React render passes that flush ANY pending
  // commit, so asserting "still Canary" is load-bearing: a missing `if (active)` guard would have
  // queued setState('Enabled'), and these passes would surface it. (Verified to fail under that mutation.)
  await rerender({ id: 'comm_2' })
  await rerender({ id: 'comm_2' })
  expect(result.current.state).toBe('Canary') // not overwritten by the stale 'Enabled'
  expect(result.current.loading).toBe(false)
})

test('advance holds the pending lock until the request settles', async () => {
  let release: () => void = () => {}
  const resolveFlag = vi.fn(async () => ({ state: 'Off' }))
  const advanceRollout = vi.fn(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ state: 'Enabling' })
      }),
  )
  const api = { resolveFlag, advanceRollout } as unknown as ApiClient
  const { result } = await renderHook(() => useRollout(api, 'comm_1'))

  await vi.waitFor(() => expect(result.current.loading).toBe(false))
  const advancing = result.current.advance('EnableRequested')
  await vi.waitFor(() => expect(result.current.pending).toBe(true))
  release()
  await advancing

  await vi.waitFor(() => expect(result.current.pending).toBe(false))
})
