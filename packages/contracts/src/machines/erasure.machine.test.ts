import { describe, expect, it } from 'vitest'
import { createActor } from 'xstate'
import { erasureMachine, isErasureTerminal } from './erasure.machine'

describe('erasure saga machine', () => {
  it('advances Requested through Cascading to Erased when every participant confirms', () => {
    const actor = createActor(erasureMachine)
    actor.start()
    expect(actor.getSnapshot().value).toBe('Requested')
    actor.send({ type: 'Start' })
    expect(actor.getSnapshot().value).toBe('Cascading')
    actor.send({ type: 'CascadeConfirmed' })
    expect(actor.getSnapshot().value).toBe('Erased')
    actor.stop()
  })

  it('routes Cascading to Incomplete when a participant has not confirmed', () => {
    const actor = createActor(erasureMachine)
    actor.start()
    actor.send({ type: 'Start' })
    actor.send({ type: 'CascadeIncomplete' })
    expect(actor.getSnapshot().value).toBe('Incomplete')
    actor.stop()
  })

  it('re-drives Incomplete back through Cascading to Erased on a retry (a redelivery)', () => {
    const actor = createActor(erasureMachine)
    actor.start()
    actor.send({ type: 'Start' })
    actor.send({ type: 'CascadeIncomplete' })
    actor.send({ type: 'Start' })
    expect(actor.getSnapshot().value).toBe('Cascading')
    actor.send({ type: 'CascadeConfirmed' })
    expect(actor.getSnapshot().value).toBe('Erased')
    actor.stop()
  })

  it('treats only Erased as terminal', () => {
    expect(isErasureTerminal('Erased')).toBe(true)
    expect(isErasureTerminal('Incomplete')).toBe(false)
    expect(isErasureTerminal('Cascading')).toBe(false)
    expect(isErasureTerminal('Requested')).toBe(false)
  })

  // Same @xstate/graph-traversability guard the rest of the fleet's machines carry: no invoke,
  // no after, so MBT and Tracetest reverse-conformance operate on this machine unchanged.
  const stateConfigs = Object.entries(
    (erasureMachine.config.states ?? {}) as Record<string, Record<string, unknown>>,
  )

  it.each(
    stateConfigs,
  )('state %s declares neither invoke nor after so the machine stays @xstate/graph-traversable', (_name, config) => {
    expect('invoke' in config).toBe(false)
    expect('after' in config).toBe(false)
  })
})
