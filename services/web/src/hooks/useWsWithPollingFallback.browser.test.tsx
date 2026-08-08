/// <reference types="@vitest/browser/matchers" />

import type { WsEnvelope } from '@qaroom/contracts'
import { expect, test, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import type { ApiClient } from '../api/client'
import type { StreamConnector } from './useWsWithPollingFallback'
import { useWsWithPollingFallback } from './useWsWithPollingFallback'

// Hook behaviour test (ADR-0027). The merge-dedup oracle (`prepend`) is pinned by the node property
// suite; THIS file drives the two React effects the pure test cannot reach — the polling interval
// timer and the optional WebSocket connector — through `renderHook`. A contract-valid envelope keyed
// on `seq` stands in for real feed traffic; a fake `connect` captures the handlers so the test can
// fire onOpen/onEvent/onClose itself, the same way the live socket would.

const frame = (seq: number): WsEnvelope => ({
  type: 'flag.state.changed',
  seq,
  community_id: 'comm_00000000000000000000000000',
  occurred_at: '2026-01-01T00:00:00.000Z',
  flag_key: 'beta-feed',
  state: 'Enabled',
  enabled: true,
})

test('polls again on the interval timer, advancing the cursor each page', async () => {
  const listEvents = vi.fn(async (_communityId: string, after: number) => ({
    community_id: 'comm_1',
    events: [frame(after + 1)],
    cursor: after + 1,
  }))
  const api = { listEvents } as unknown as ApiClient

  const { result } = await renderHook(() =>
    useWsWithPollingFallback(api, 'comm_1', { intervalMs: 10 }),
  )

  // The immediate poll plus at least one interval poll: proves the setInterval callback fires and the
  // advancing cursor is threaded back in (after 0 -> 1 -> 2 ...).
  await vi.waitFor(() => expect(listEvents.mock.calls.length).toBeGreaterThanOrEqual(2))
  expect(listEvents.mock.calls[1]?.[1]).toBe(1)
  // With no connector supplied the live-socket effect returns early, so `live` never flips.
  expect(result.current.live).toBe(false)
})

test('an empty poll page leaves the feed empty (the length-0 short-circuit)', async () => {
  const listEvents = vi.fn(async () => ({ community_id: 'comm_1', events: [], cursor: 0 }))
  const api = { listEvents } as unknown as ApiClient

  const { result } = await renderHook(() =>
    useWsWithPollingFallback(api, 'comm_1', { intervalMs: 10 }),
  )

  await vi.waitFor(() => expect(listEvents).toHaveBeenCalled())
  expect(result.current.events).toEqual([])
})

test('a supplied connector drives live state, feeds socket events, and disconnects on unmount', async () => {
  const listEvents = vi.fn(async () => ({ community_id: 'comm_1', events: [], cursor: 0 }))
  const api = { listEvents } as unknown as ApiClient
  let captured: Parameters<StreamConnector>[0] | undefined
  const disconnect = vi.fn()
  const connect: StreamConnector = (handlers) => {
    captured = handlers
    return disconnect
  }

  const { result, unmount } = await renderHook(() =>
    useWsWithPollingFallback(api, 'comm_1', { intervalMs: 10_000, connect }),
  )

  await vi.waitFor(() => expect(captured).toBeDefined())

  captured?.onOpen()
  await vi.waitFor(() => expect(result.current.live).toBe(true))

  captured?.onEvent(frame(7))
  await vi.waitFor(() => expect(result.current.events.map((e) => e.seq)).toContain(7))

  captured?.onClose()
  await vi.waitFor(() => expect(result.current.live).toBe(false))

  await unmount()
  expect(disconnect).toHaveBeenCalledTimes(1)
})

// A rejecting poll had nowhere to go: `void poll()` with no catch raised an unhandled rejection on
// every tick, forever, while the page showed an empty feed and a reassuring badge. The hook now
// exposes the failure so a page can say the feed is stale.
test('a failing poll surfaces an error instead of raising an unhandled rejection', async () => {
  const api = {
    listEvents: async () => {
      throw new Error('gateway down')
    },
  } as unknown as ApiClient

  const { result } = await renderHook(() =>
    useWsWithPollingFallback(api, 'comm_1', { intervalMs: 10 }),
  )

  await vi.waitFor(() => expect(result.current.error).toBe('gateway down'))
  expect(result.current.events).toEqual([])
})

// ADR-0025 put the events route behind edge auth, so a poll with no bearer is a 401 and the whole
// Commitment-11 fallback silently delivers nothing.
test('the poll forwards the session token to the edge-authed events route', async () => {
  const listEvents = vi.fn(async () => ({ community_id: 'comm_1', events: [], cursor: 0 }))
  const api = { listEvents } as unknown as ApiClient

  await renderHook(() =>
    useWsWithPollingFallback(api, 'comm_1', { intervalMs: 10_000, token: 'access-token' }),
  )

  await vi.waitFor(() => expect(listEvents).toHaveBeenCalledWith('comm_1', 0, 'access-token'))
})
