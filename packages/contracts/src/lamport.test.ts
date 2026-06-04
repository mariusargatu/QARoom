import { describe, expect, it } from 'vitest'
import { asOf, LamportGate } from './lamport'

const stubIds = { next: (prefix: string) => `${prefix}_stub` }
const stubClock = { now: () => new Date('2026-01-01T00:00:00.000Z') }

describe('LamportGate', () => {
  it('bumping increases the counter monotonically and exposes the new value', () => {
    const gate = new LamportGate(stubIds)
    const first = gate.bump()
    const second = gate.bump()
    expect(second.lamport).toBeGreaterThan(first.lamport)
    expect(gate.value).toBe(2)
  })

  it('reading the gate returns the current value without advancing it', () => {
    const gate = new LamportGate(stubIds)
    gate.bump()
    const valueBeforeRead = gate.value
    gate.read()
    expect(gate.value).toBe(valueBeforeRead)
  })

  it('reading returns the current lamport and a freshly minted snapshot id', () => {
    const gate = new LamportGate(stubIds)
    gate.bump()
    const tick = gate.read()
    expect(tick).toEqual({ lamport: 1, snapshot_id: 'snap_stub' })
  })

  it('every bump carries a snapshot id minted from the IdGenerator', () => {
    const gate = new LamportGate(stubIds)
    expect(gate.bump().snapshot_id).toBe('snap_stub')
  })

  it('bump emits the new lamport value as a span attribute', () => {
    const attrs: Array<[string, number | string]> = []
    const sink = { setAttribute: (k: string, v: number | string) => attrs.push([k, v]) }
    const gate = new LamportGate(stubIds, sink)
    gate.bump()
    expect(attrs).toEqual([['qaroom.lamport', 1]])
  })

  it('restore sets the counter back to a captured value', () => {
    const gate = new LamportGate(stubIds)
    gate.bump()
    gate.bump()
    gate.restore(7)
    expect(gate.value).toBe(7)
  })
})

describe('asOf', () => {
  it('builds the read envelope from the clock and the gate without advancing it', () => {
    const gate = new LamportGate(stubIds)
    gate.bump()
    const envelope = asOf(stubClock, gate)
    expect(envelope).toEqual({
      snapshot_id: 'snap_stub',
      lamport: 1,
      wall_clock: '2026-01-01T00:00:00.000Z',
    })
    expect(gate.value).toBe(1)
  })
})
