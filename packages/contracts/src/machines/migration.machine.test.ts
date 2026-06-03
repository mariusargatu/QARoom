import { describe, expect, it } from 'vitest'
import { createActor } from 'xstate'
import { migrationMachine } from './migration.machine'

describe('migration machine', () => {
  it('advances Pending through Backfilling and Verifying to Done on the forward events', () => {
    const actor = createActor(migrationMachine)
    actor.start()
    expect(actor.getSnapshot().value).toBe('Pending')
    actor.send({ type: 'Start' })
    expect(actor.getSnapshot().value).toBe('Backfilling')
    actor.send({ type: 'BackfillCompleted' })
    expect(actor.getSnapshot().value).toBe('Verifying')
    actor.send({ type: 'VerificationPassed' })
    expect(actor.getSnapshot().value).toBe('Done')
    actor.stop()
  })

  it('returns from Verifying to Pending when verification fails so the failure stays observable', () => {
    const actor = createActor(migrationMachine)
    actor.start()
    actor.send({ type: 'Start' })
    actor.send({ type: 'BackfillCompleted' })
    actor.send({ type: 'VerificationFailed' })
    expect(actor.getSnapshot().value).toBe('Pending')
    actor.stop()
  })

  it('reverses Done through RollingBack back to Pending on a rollback request', () => {
    const actor = createActor(migrationMachine)
    actor.start()
    actor.send({ type: 'Start' })
    actor.send({ type: 'BackfillCompleted' })
    actor.send({ type: 'VerificationPassed' })
    actor.send({ type: 'RollbackRequested' })
    expect(actor.getSnapshot().value).toBe('RollingBack')
    actor.send({ type: 'RollbackCompleted' })
    expect(actor.getSnapshot().value).toBe('Pending')
    actor.stop()
  })

  // The Milestone-5 precedent, pinned now: @xstate/graph hard-rejects invoke/after and
  // any context explodes its BFS. This guard fails the moment someone adds an invocation
  // or delayed transition to the migration machine.
  const stateConfigs = Object.entries(
    (migrationMachine.config.states ?? {}) as Record<string, Record<string, unknown>>,
  )

  it.each(
    stateConfigs,
  )('state %s declares neither invoke nor after so the machine stays @xstate/graph-traversable', (_name, config) => {
    expect('invoke' in config).toBe(false)
    expect('after' in config).toBe(false)
  })
})
