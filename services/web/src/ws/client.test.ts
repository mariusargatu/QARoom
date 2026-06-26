import { EXAMPLE_COMMUNITY_ID, EXAMPLE_FLAG_KEY } from '@qaroom/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectWs } from './client'

// Wiring test for the WebSocket connect helper (node env, `*.test.ts`). A real socket is never opened:
// the global `WebSocket` is stubbed with a fake that records the constructor arguments and lets a test
// dispatch open/close/message frames synchronously, so every branch of the handler wiring — the scheme
// upgrade, the ticket subprotocol, the schema gate on inbound frames, and the disconnect — is driven
// deterministically without a network or a clock.

type Listener = (event: { data: string }) => void

class FakeWebSocket {
  static last: FakeWebSocket | null = null
  readonly url: string
  readonly protocols: string | string[] | undefined
  closeCalls = 0
  private readonly listeners = new Map<string, Listener[]>()

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    this.protocols = protocols
    FakeWebSocket.last = this
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  close(): void {
    this.closeCalls += 1
  }

  dispatch(type: string, event: { data: string } = { data: '' }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

const lastSocket = (): FakeWebSocket => {
  const socket = FakeWebSocket.last
  expect(socket).not.toBeNull()
  return socket as FakeWebSocket
}

const flagFrame = (seq: number) => ({
  type: 'flag.state.changed' as const,
  seq,
  community_id: EXAMPLE_COMMUNITY_ID,
  occurred_at: '2026-01-01T00:00:00.000Z',
  flag_key: EXAMPLE_FLAG_KEY,
  state: 'Enabled' as const,
  enabled: true,
})

afterEach(() => {
  FakeWebSocket.last = null
  vi.unstubAllGlobals()
})

describe('connectWs', () => {
  it('opens a ws (not http) URL carrying the community as a query param', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    connectWs('http://gateway', EXAMPLE_COMMUNITY_ID, 'tkt', { onEvent: vi.fn() })
    expect(lastSocket().url).toBe(`ws://gateway/ws?community=${EXAMPLE_COMMUNITY_ID}`)
  })

  it('upgrades an https base URL to the wss scheme', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    connectWs('https://gateway', EXAMPLE_COMMUNITY_ID, 'tkt', { onEvent: vi.fn() })
    expect(lastSocket().url).toBe(`wss://gateway/ws?community=${EXAMPLE_COMMUNITY_ID}`)
  })

  it('presents the ticket in the subprotocol as ticket.<ticket> (ADR-0013)', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    connectWs('http://gateway', EXAMPLE_COMMUNITY_ID, 'secret-ticket', { onEvent: vi.fn() })
    expect(lastSocket().protocols).toEqual(['ticket.secret-ticket'])
  })

  it('invokes onOpen when the socket opens', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const onOpen = vi.fn()
    connectWs('http://gateway', EXAMPLE_COMMUNITY_ID, 'tkt', { onEvent: vi.fn(), onOpen })
    lastSocket().dispatch('open')
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('invokes onClose when the socket closes', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const onClose = vi.fn()
    connectWs('http://gateway', EXAMPLE_COMMUNITY_ID, 'tkt', { onEvent: vi.fn(), onClose })
    lastSocket().dispatch('close')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('parses a valid envelope and forwards it to onEvent', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const onEvent = vi.fn()
    connectWs('http://gateway', EXAMPLE_COMMUNITY_ID, 'tkt', { onEvent })
    lastSocket().dispatch('message', { data: JSON.stringify(flagFrame(7)) })
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'flag.state.changed', seq: 7 }),
    )
  })

  it('drops a frame that fails the WsEnvelope schema (onEvent never fires)', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const onEvent = vi.fn()
    connectWs('http://gateway', EXAMPLE_COMMUNITY_ID, 'tkt', { onEvent })
    lastSocket().dispatch('message', { data: JSON.stringify({ type: 'not.a.real.frame' }) })
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('returns a disconnect function that closes the socket', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const disconnect = connectWs('http://gateway', EXAMPLE_COMMUNITY_ID, 'tkt', {
      onEvent: vi.fn(),
    })
    disconnect()
    expect(lastSocket().closeCalls).toBe(1)
  })

  it('tolerates open and close frames when the optional handlers are omitted', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    connectWs('http://gateway', EXAMPLE_COMMUNITY_ID, 'tkt', { onEvent: vi.fn() })
    const socket = lastSocket()
    expect(() => {
      socket.dispatch('open')
      socket.dispatch('close')
    }).not.toThrow()
  })
})
