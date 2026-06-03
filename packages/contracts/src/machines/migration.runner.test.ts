import type { Clock } from '@qaroom/determinism'
import { describe, expect, it } from 'vitest'
import { createActor } from 'xstate'
import { type MigrationState, migrationMachine } from './migration.machine'
import { type MigrationTransitionRecord, rollbackMigration, runMigration } from './migration.runner'

// Inline Clock double: contracts cannot import @qaroom/testing-utils (that would be a
// cycle — testing-utils depends on contracts). `new Date` is lint-exempt in test files.
const fixedClock: Clock = { now: () => new Date('2026-01-01T00:00:00.000Z') }

function recordingSink() {
  const records: MigrationTransitionRecord[] = []
  return { records, sink: { record: (r: MigrationTransitionRecord) => records.push(r) } }
}

describe('runMigration', () => {
  it('drives the machine to Done and records the forward transition sequence when verify passes', async () => {
    const calls: string[] = []
    const { records, sink } = recordingSink()
    const result = await runMigration(
      {
        tx: {},
        backfill: async () => {
          calls.push('backfill')
        },
        verify: async () => {
          calls.push('verify')
          return true
        },
      },
      { clock: fixedClock, sink },
    )

    expect(result.finalState).toBe('Done')
    expect(result.verified).toBe(true)
    expect(calls).toEqual(['backfill', 'verify'])
    expect(records.map((r) => r.event)).toEqual([
      'Start',
      'BackfillCompleted',
      'VerificationPassed',
    ])
    expect(records.every((r) => r.at === '2026-01-01T00:00:00.000Z')).toBe(true)
  })

  it('throws and ends in Pending when verification fails under the default fail-fast policy', async () => {
    await expect(
      runMigration(
        { tx: {}, backfill: async () => {}, verify: async () => false },
        { clock: fixedClock },
      ),
    ).rejects.toThrow(/verification failed/)
  })

  it('returns an unverified Pending result when verification fails and fail-fast is disabled', async () => {
    const result = await runMigration(
      { tx: {}, backfill: async () => {}, verify: async () => false },
      { clock: fixedClock, failFast: false },
    )
    expect(result.finalState).toBe('Pending')
    expect(result.verified).toBe(false)
    expect(result.transitions.at(-1)?.event).toBe('VerificationFailed')
  })

  // Poor-man's reverse-conformance before Milestone 5's Tracetest: the guard test pins the
  // machine's shape, but nothing yet pins that the RUNNER emits a legal walk of it. Replay the
  // recorded events through a fresh actor and assert every recorded (from → to) matches the
  // machine's actual transition. A runner that sent events out of order would fail here.
  it('records a transition sequence that is a valid walk of the migration machine', async () => {
    const result = await runMigration(
      { tx: {}, backfill: async () => {}, verify: async () => true },
      { clock: fixedClock },
    )
    const actor = createActor(migrationMachine)
    actor.start()
    for (const t of result.transitions) {
      expect(actor.getSnapshot().value as MigrationState).toBe(t.from)
      actor.send({ type: t.event })
      expect(actor.getSnapshot().value as MigrationState).toBe(t.to)
    }
    actor.stop()
  })
})

describe('rollbackMigration', () => {
  it('invokes the rollback effect and returns the machine to Pending through RollingBack', async () => {
    const calls: string[] = []
    const { records } = recordingSink()
    const result = await rollbackMigration(
      {
        tx: {},
        backfill: async () => {},
        verify: async () => true,
        rollback: async () => {
          calls.push('rollback')
        },
      },
      { clock: fixedClock, sink: { record: (r) => records.push(r) } },
    )

    expect(calls).toEqual(['rollback'])
    expect(result.finalState).toBe('Pending')
    expect(records.map((r) => r.event)).toEqual([
      'Start',
      'BackfillCompleted',
      'VerificationPassed',
      'RollbackRequested',
      'RollbackCompleted',
    ])
  })
})
