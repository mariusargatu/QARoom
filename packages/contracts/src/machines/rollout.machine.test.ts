import { describe, expect, it } from 'vitest'
import { createActor } from 'xstate'
import { FlagState, RolloutEventName } from '../flag'
import { rolloutEnabled, rolloutMachine } from './rollout.machine'

describe('rollout machine', () => {
  it('advances Off through Enabling and Canary to Enabled on the forward events', () => {
    const actor = createActor(rolloutMachine)
    actor.start()
    expect(actor.getSnapshot().value).toBe('Off')
    actor.send({ type: 'EnableRequested' })
    expect(actor.getSnapshot().value).toBe('Enabling')
    actor.send({ type: 'CanaryConfirmed' })
    expect(actor.getSnapshot().value).toBe('Canary')
    actor.send({ type: 'RolloutCompleted' })
    expect(actor.getSnapshot().value).toBe('Enabled')
    actor.stop()
  })

  it('reverses Enabled through Disabling back to Off on a disable request', () => {
    const actor = createActor(rolloutMachine)
    actor.start()
    actor.send({ type: 'EnableRequested' })
    actor.send({ type: 'CanaryConfirmed' })
    actor.send({ type: 'RolloutCompleted' })
    actor.send({ type: 'DisableRequested' })
    expect(actor.getSnapshot().value).toBe('Disabling')
    actor.send({ type: 'DisableCompleted' })
    expect(actor.getSnapshot().value).toBe('Off')
    actor.stop()
  })

  it('aborts a rollout from Enabling back to Off', () => {
    const actor = createActor(rolloutMachine)
    actor.start()
    actor.send({ type: 'EnableRequested' })
    actor.send({ type: 'RolloutAborted' })
    expect(actor.getSnapshot().value).toBe('Off')
    actor.stop()
  })

  it('ignores an event that is illegal from the current state (no transition)', () => {
    const actor = createActor(rolloutMachine)
    actor.start()
    // RolloutCompleted is only legal from Canary; from Off it is a no-op.
    actor.send({ type: 'RolloutCompleted' })
    expect(actor.getSnapshot().value).toBe('Off')
    actor.stop()
  })

  it('treats only Enabled as the gating-on projection', () => {
    expect(rolloutEnabled('Enabled')).toBe(true)
    expect(rolloutEnabled('Canary')).toBe(false)
    expect(rolloutEnabled('Off')).toBe(false)
  })
})

// The Milestone-5 precedent, pinned: @xstate/graph hard-rejects invoke/after and any
// context explodes its BFS. This guard fails the moment someone adds an invocation or
// delayed transition to the rollout machine.
const stateConfigs = Object.entries(
  (rolloutMachine.config.states ?? {}) as Record<string, Record<string, unknown>>,
)

describe('rollout machine stays @xstate/graph-traversable', () => {
  it.each(stateConfigs)('state %s declares neither invoke nor after', (_name, config) => {
    expect('invoke' in config).toBe(false)
    expect('after' in config).toBe(false)
  })

  it('declares no machine-level context keys (context-free)', () => {
    expect(Object.keys(rolloutMachine.config.context ?? {})).toHaveLength(0)
  })
})

describe('machine states and events agree with the FlagState / RolloutEventName contracts', () => {
  it('every machine state is a FlagState and vice versa', () => {
    const machineStates = Object.keys(rolloutMachine.config.states ?? {}).sort()
    expect(machineStates).toEqual([...FlagState.options].sort())
  })

  it('every machine event name is a RolloutEventName', () => {
    const eventNames = new Set<string>()
    for (const config of Object.values(rolloutMachine.config.states ?? {})) {
      for (const on of Object.keys((config as { on?: Record<string, unknown> }).on ?? {})) {
        eventNames.add(on)
      }
    }
    for (const name of eventNames) {
      expect(RolloutEventName.options).toContain(name)
    }
  })
})
