import { setup } from 'xstate'

/**
 * The GDPR cross-service erasure saga (Milestone 13, ADR-0036). A `DELETE /api/users/{id}` is a
 * distributed-correctness problem: identity-service deletes its own user data, then content- and
 * donations-service must each delete their slice of that user. The saga's job is to track that
 * cascade to a terminal state — every participant confirmed, or one did not.
 *
 *   Requested  --Start--> Cascading
 *   Cascading  --CascadeConfirmed--> Erased        (every participant deleted its slice)
 *   Cascading  --CascadeIncomplete--> Incomplete   (≥1 participant has not confirmed)
 *   Incomplete --Start--> Cascading                (re-drive: a redelivery / operator retry)
 *
 * DELIBERATELY invoke-free and context-free, exactly like `migration.machine.ts` and
 * `webhook-delivery.machine.ts`. The actual I/O (deleting rows, draining the outbox, polling each
 * durable, confirming per-service completion) happens in the saga RUNNER (`erasure.runner.ts`),
 * which drives this machine via `send` after each async step resolves. Per-service completion is
 * tracked in the runner's records, NOT in machine context — the @xstate/graph finiteness constraint
 * the rest of the fleet's machines observe. A guard test (erasure.machine.test.ts) pins no
 * invoke/after, so MBT and reverse-conformance operate on this machine unchanged.
 *
 * `Erased` and `Incomplete` are terminal but NOT XState `final` states (the rollout/webhook
 * precedent): `Incomplete --Start--> Cascading` must stay enabled so a stored saga can be re-driven
 * after a redelivery, and a stored saga can be re-hydrated from its state via `resolveState`.
 */

export type ErasureState = 'Requested' | 'Cascading' | 'Erased' | 'Incomplete'

export type ErasureEvent =
  | { type: 'Start' }
  | { type: 'CascadeConfirmed' }
  | { type: 'CascadeIncomplete' }

/**
 * Context is the EMPTY object on purpose. Per-saga data (which services confirmed, rows deleted,
 * the requesting clock stamp) lives in the runner's records and the saga ledger, NOT in machine
 * context — the constraint that keeps @xstate/graph traversal finite.
 */
export type ErasureContext = Record<string, never>

export const erasureMachine = setup({
  types: {
    context: {} as ErasureContext,
    events: {} as ErasureEvent,
  },
}).createMachine({
  id: 'erasure',
  initial: 'Requested',
  context: {},
  states: {
    Requested: {
      on: { Start: { target: 'Cascading' } },
    },
    Cascading: {
      on: {
        CascadeConfirmed: { target: 'Erased' },
        CascadeIncomplete: { target: 'Incomplete' },
      },
    },
    Erased: {
      // Terminal, but not an XState `final` state (rollout/webhook precedent).
    },
    Incomplete: {
      // Re-drivable: a redelivery or operator retry sends `Start` to re-attempt the cascade.
      on: { Start: { target: 'Cascading' } },
    },
  },
})

export type ErasureMachine = typeof erasureMachine

/** The reached-a-terminal-state projection used by saga bookkeeping / `/system/state` counts. */
export function isErasureTerminal(state: ErasureState): boolean {
  return state === 'Erased'
}
