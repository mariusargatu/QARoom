import { describe, expect, it } from 'vitest'
import { LamportGate } from './lamport'

const stubIds = { next: (prefix: string) => `${prefix}_stub` }

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

  it('every bump carries a snapshot id minted from the IdGenerator', () => {
    const gate = new LamportGate(stubIds)
    expect(gate.bump().snapshot_id).toBe('snap_stub')
  })
})
