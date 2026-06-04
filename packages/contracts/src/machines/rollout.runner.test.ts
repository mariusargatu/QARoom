import type { Clock } from '@qaroom/determinism'
import { describe, expect, it } from 'vitest'
import { applyRolloutEvent, type RolloutTransitionRecord } from './rollout.runner'

const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) })

function recordingSink() {
  const records: RolloutTransitionRecord[] = []
  return { records, record: (t: RolloutTransitionRecord) => records.push(t) }
}

describe('applyRolloutEvent', () => {
  it('applies a legal event and reports the resulting transition as changed', () => {
    const result = applyRolloutEvent('Off', 'EnableRequested', {
      clock: fixedClock('2026-06-04T00:00:00.000Z'),
    })
    expect(result.changed).toBe(true)
    expect(result.from).toBe('Off')
    expect(result.to).toBe('Enabling')
    expect(result.transition?.at).toBe('2026-06-04T00:00:00.000Z')
  })

  it('reports an illegal event as unchanged without inventing a transition', () => {
    const sink = recordingSink()
    const result = applyRolloutEvent('Off', 'RolloutCompleted', {
      clock: fixedClock('2026-06-04T00:00:00.000Z'),
      sink,
    })
    expect(result.changed).toBe(false)
    expect(result.from).toBe('Off')
    expect(result.to).toBe('Off')
    expect(result.transition).toBeUndefined()
    expect(sink.records).toHaveLength(0)
  })

  it('emits each real transition to the sink with the injected clock stamp', () => {
    const sink = recordingSink()
    applyRolloutEvent('Enabled', 'DisableRequested', {
      clock: fixedClock('2026-06-04T01:02:03.000Z'),
      sink,
    })
    expect(sink.records).toEqual([
      {
        from: 'Enabled',
        to: 'Disabling',
        event: 'DisableRequested',
        at: '2026-06-04T01:02:03.000Z',
      },
    ])
  })

  it('starts the actor from the given current state, not the machine initial state', () => {
    // If the runner ignored currentState and always started at Off, DisableRequested would
    // be illegal (changed:false). Reaching Disabling proves it resumed from Enabled.
    const result = applyRolloutEvent('Enabled', 'DisableRequested', {
      clock: fixedClock('2026-06-04T00:00:00.000Z'),
    })
    expect(result.changed).toBe(true)
    expect(result.to).toBe('Disabling')
  })
})
