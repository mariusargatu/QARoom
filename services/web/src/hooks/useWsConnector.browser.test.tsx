import { afterEach, expect, test, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import type { ApiClient } from '../api/client'
import { useWsConnector } from './useWsConnector'

// Hook test (ADR-0027): useWsConnector is a pure `useMemo` that derives a StreamConnector from its
// inputs. We cover the derivable surface — no token => no connector (the feed polls only), a token =>
// a connector, the memoization, and that invoking the connector first mints a one-use WS ticket. We do
// NOT assert the live socket: connectWs opens a real `new WebSocket` against the gateway, which has no
// endpoint under test; holding `createWsTicket` pending keeps the connector from ever reaching it.

const handlers = () => ({ onEvent: vi.fn(), onOpen: vi.fn(), onClose: vi.fn() })

// A stand-in for the real WebSocket so `connectWs` can run without a live gateway socket. It records
// what it was opened with and whether it was closed, which is all the connector path observes.
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  closed = false
  readonly url: string
  readonly protocols?: string | string[]
  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    this.protocols = protocols
    FakeWebSocket.instances.push(this)
  }
  addEventListener() {}
  close() {
    this.closed = true
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeWebSocket.instances = []
})

test('returns no connector without a token so the feed polls only', async () => {
  const api = {} as unknown as ApiClient
  const { result } = await renderHook(() => useWsConnector(api, '', null, 'comm_1'))

  expect(result.current).toBeUndefined()
})

test('builds a connector when a token is present', async () => {
  const api = {} as unknown as ApiClient
  const { result } = await renderHook(() => useWsConnector(api, '', 'tok_1', 'comm_1'))

  expect(result.current).toBeTypeOf('function')
})

test('memoizes the same connector across re-renders with unchanged inputs', async () => {
  const api = {} as unknown as ApiClient
  const { result, rerender } = await renderHook<
    { token: string | null },
    ReturnType<typeof useWsConnector>
  >((props) => useWsConnector(api, '', props?.token ?? null, 'comm_1'), {
    initialProps: { token: 'tok_1' },
  })

  const first = result.current
  await rerender({ token: 'tok_1' })

  expect(result.current).toBe(first)
})

test('invoking the connector mints a one-use ws ticket for the token', async () => {
  // Never resolves: the connector awaits the ticket before opening a socket, so connectWs never runs.
  const createWsTicket = vi.fn(() => new Promise(() => {}))
  const api = { createWsTicket } as unknown as ApiClient
  const { result } = await renderHook(() =>
    useWsConnector(api, 'http://localhost:0', 'tok_1', 'comm_1'),
  )

  const connect = result.current
  expect(connect).toBeTypeOf('function')
  const disconnect = connect?.(handlers())

  await vi.waitFor(() => expect(createWsTicket).toHaveBeenCalledWith('tok_1'))
  disconnect?.()
})

test('once the ticket resolves it opens the socket (not cancelled) and disconnect closes it', async () => {
  vi.stubGlobal('WebSocket', FakeWebSocket)
  const createWsTicket = vi.fn(async () => ({ ticket: 'tk_1' }))
  const api = { createWsTicket } as unknown as ApiClient
  const { result } = await renderHook(() =>
    useWsConnector(api, 'http://gw.test', 'tok_1', 'comm_1'),
  )

  const disconnect = result.current?.(handlers())

  // The `.then` runs the `if (!cancelled)` true arm: connectWs opens a socket from the derived WS base.
  await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
  const socket = FakeWebSocket.instances[0]
  expect(socket?.url).toBe('ws://gw.test/ws?community=comm_1')
  expect(socket?.protocols).toEqual(['ticket.tk_1'])

  disconnect?.() // the connector's teardown closes the live socket connectWs returned
  expect(socket?.closed).toBe(true)
})

test('cancelling before the ticket resolves skips the socket entirely (cancelled guard)', async () => {
  vi.stubGlobal('WebSocket', FakeWebSocket)
  let resolveTicket: (t: { ticket: string }) => void = () => {}
  const createWsTicket = vi.fn(
    () =>
      new Promise<{ ticket: string }>((resolve) => {
        resolveTicket = resolve
      }),
  )
  const api = { createWsTicket } as unknown as ApiClient
  const { result } = await renderHook(() =>
    useWsConnector(api, 'http://gw.test', 'tok_1', 'comm_1'),
  )

  const disconnect = result.current?.(handlers())
  await vi.waitFor(() => expect(createWsTicket).toHaveBeenCalled())
  disconnect?.() // cancel while the ticket is still pending -> cancelled = true
  resolveTicket({ ticket: 'tk_late' }) // resolves late: the `if (!cancelled)` false arm must skip connectWs
  await Promise.resolve()
  await Promise.resolve()

  expect(FakeWebSocket.instances).toHaveLength(0) // no socket ever opened
})

test('a ticket-mint failure is swallowed so the polling fallback stands (no socket, no throw)', async () => {
  vi.stubGlobal('WebSocket', FakeWebSocket)
  const createWsTicket = vi.fn(async () => {
    throw new Error('ticket denied')
  })
  const api = { createWsTicket } as unknown as ApiClient
  const { result } = await renderHook(() =>
    useWsConnector(api, 'http://gw.test', 'tok_1', 'comm_1'),
  )

  const disconnect = result.current?.(handlers())
  await vi.waitFor(() => expect(createWsTicket).toHaveBeenCalledWith('tok_1'))
  await Promise.resolve()
  await Promise.resolve()

  expect(FakeWebSocket.instances).toHaveLength(0) // the `.catch` swallowed it; no socket opened
  disconnect?.()
})
