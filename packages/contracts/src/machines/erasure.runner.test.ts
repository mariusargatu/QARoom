import { FixedClock } from '@qaroom/determinism'
import { describe, expect, it } from 'vitest'
import { type ErasureParticipant, runErasureSaga } from './erasure.runner'

const clock = new FixedClock(new Date('2026-06-28T00:00:00.000Z'))

function participant(service: string, confirmed: boolean, rowsDeleted = 0): ErasureParticipant {
  return { service, erase: () => Promise.resolve({ confirmed, rowsDeleted }) }
}

describe('runErasureSaga', () => {
  it('reaches Erased and reports complete when every participant confirms', async () => {
    const result = await runErasureSaga(
      [participant('content', true, 3), participant('donations', true, 1)],
      { clock },
    )
    expect(result.finalState).toBe('Erased')
    expect(result.complete).toBe(true)
    expect(result.perService).toEqual([
      { service: 'content', confirmed: true, rowsDeleted: 3 },
      { service: 'donations', confirmed: true, rowsDeleted: 1 },
    ])
  })

  it('reaches Incomplete and names the blocking service when one participant does not confirm', async () => {
    const result = await runErasureSaga(
      [participant('content', false, 0), participant('donations', true, 1)],
      { clock },
    )
    expect(result.finalState).toBe('Incomplete')
    expect(result.complete).toBe(false)
    expect(result.perService.find((p) => p.service === 'content')?.confirmed).toBe(false)
  })

  it('attempts every participant even when an earlier one does not confirm (no short-circuit)', async () => {
    const seen: string[] = []
    const tracking = (service: string, confirmed: boolean): ErasureParticipant => ({
      service,
      erase: () => {
        seen.push(service)
        return Promise.resolve({ confirmed, rowsDeleted: 0 })
      },
    })
    await runErasureSaga([tracking('content', false), tracking('donations', true)], { clock })
    expect(seen).toEqual(['content', 'donations'])
  })

  it('records each transition with an injected clock stamp', async () => {
    const result = await runErasureSaga([participant('content', true)], { clock })
    expect(result.transitions.map((t) => [t.from, t.event, t.to])).toEqual([
      ['Requested', 'Start', 'Cascading'],
      ['Cascading', 'CascadeConfirmed', 'Erased'],
    ])
    expect(result.transitions.every((t) => t.at === '2026-06-28T00:00:00.000Z')).toBe(true)
  })
})
