import { setup } from 'xstate'

/**
 * The reusable migration-as-state-machine (Milestone 2, "first taste of XState").
 * Pending → Backfilling → Verifying → Done, with a reverse path
 * Done → RollingBack → Pending on RollbackRequested.
 *
 * DELIBERATELY invoke-free and context-free. The actual DB work (up/down, backfill,
 * verify) is performed by `runMigration` (migration.runner.ts), which drives this
 * machine via `send` after each async step resolves. This sets the Milestone-5
 * precedent: @xstate/graph hard-rejects `invoke`/`after` and any `context` explodes
 * the BFS, so async boundaries are modeled as explicit EVENTS, never invocations.
 * A guard test (migration.machine.test.ts) pins that this machine has no invoke/after.
 *
 * States are PascalCase nouns (docs/05); events are PascalCase verbs.
 */

export type MigrationState = 'Pending' | 'Backfilling' | 'Verifying' | 'Done' | 'RollingBack'

export type MigrationEvent =
  | { type: 'Start' }
  | { type: 'BackfillCompleted' }
  | { type: 'VerificationPassed' }
  | { type: 'VerificationFailed' }
  | { type: 'RollbackRequested' }
  | { type: 'RollbackCompleted' }

/**
 * Context is the EMPTY object on purpose. Per-migration data (rows touched, clock
 * stamp) lives in the runner's records, NOT in machine context — the Milestone-5
 * constraint that @xstate/graph traversal stays finite. A future need for per-run
 * data goes in an isolated, separately-unit-tested sub-machine, never here.
 */
export type MigrationContext = Record<string, never>

export const migrationMachine = setup({
  types: {
    context: {} as MigrationContext,
    events: {} as MigrationEvent,
  },
}).createMachine({
  id: 'migration',
  initial: 'Pending',
  context: {},
  states: {
    Pending: {
      on: { Start: { target: 'Backfilling' } },
    },
    Backfilling: {
      on: { BackfillCompleted: { target: 'Verifying' } },
    },
    Verifying: {
      on: {
        VerificationPassed: { target: 'Done' },
        // A failed verification returns to Pending (not a thrown error / dead state)
        // so the runner can re-attempt or surface it, and the transition stays
        // observable to @xstate/graph reverse-conformance in Milestone 5.
        VerificationFailed: { target: 'Pending' },
      },
    },
    Done: {
      // Not an XState `final` state: the reverse path Done → RollingBack must stay enabled.
      on: { RollbackRequested: { target: 'RollingBack' } },
    },
    RollingBack: {
      on: { RollbackCompleted: { target: 'Pending' } },
    },
  },
})

export type MigrationMachine = typeof migrationMachine
