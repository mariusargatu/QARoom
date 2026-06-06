import type { Clock } from '@qaroom/determinism'
import { createActor } from 'xstate'
import { NOOP_TRANSITION_SINK, type TransitionRecord, type TransitionSink } from './apply-event'
import { type MigrationEvent, type MigrationState, migrationMachine } from './migration.machine'

export type MigrationTransitionRecord = TransitionRecord<MigrationState, MigrationEvent['type']>
export type MigrationTransitionSink = TransitionSink<MigrationState, MigrationEvent['type']>

/** The async effects the runner drives the machine with. */
export interface MigrationSteps<Tx> {
  tx: Tx
  backfill(tx: Tx): Promise<void>
  verify(tx: Tx): Promise<boolean>
  rollback?(tx: Tx): Promise<void>
}

export interface RunMigrationOptions {
  clock: Clock
  sink?: MigrationTransitionSink
  /** When true and verify() returns false, throw after recording the transition. Default true. */
  failFast?: boolean
}

export interface MigrationRunResult {
  finalState: MigrationState
  transitions: readonly MigrationTransitionRecord[]
  verified: boolean
}

/** Send an event through the actor, recording the (from, to, event) transition with a clock stamp. */
function makeSender(
  actor: ReturnType<typeof createActor<typeof migrationMachine>>,
  clock: Clock,
  sink: MigrationTransitionSink,
  transitions: MigrationTransitionRecord[],
) {
  return (event: MigrationEvent): void => {
    const from = actor.getSnapshot().value as MigrationState
    actor.send(event)
    const to = actor.getSnapshot().value as MigrationState
    const record: MigrationTransitionRecord = {
      from,
      to,
      event: event.type,
      at: clock.now().toISOString(),
    }
    transitions.push(record)
    sink.record(record)
  }
}

/**
 * Drive `migrationMachine` Pending → Done (or surface a verification failure),
 * invoking caller-supplied async effects between transitions and recording every
 * transition with an injected clock stamp. The machine stays side-effect-free; ALL
 * I/O happens here.
 *
 *   Pending --Start--> Backfilling           (then: await backfill)
 *   Backfilling --BackfillCompleted--> Verifying  (then: const ok = await verify)
 *   Verifying --VerificationPassed--> Done    (ok === true)
 *   Verifying --VerificationFailed--> Pending (ok === false)
 */
export async function runMigration<Tx>(
  steps: MigrationSteps<Tx>,
  opts: RunMigrationOptions,
): Promise<MigrationRunResult> {
  const sink = opts.sink ?? NOOP_TRANSITION_SINK
  const transitions: MigrationTransitionRecord[] = []
  const actor = createActor(migrationMachine)
  const send = makeSender(actor, opts.clock, sink, transitions)

  actor.start()
  send({ type: 'Start' })
  await steps.backfill(steps.tx)
  send({ type: 'BackfillCompleted' })
  const ok = await steps.verify(steps.tx)
  send({ type: ok ? 'VerificationPassed' : 'VerificationFailed' })
  actor.stop()

  const finalState = (transitions.at(-1)?.to ?? 'Pending') as MigrationState
  if (!ok && opts.failFast !== false) {
    throw new Error(`migration verification failed (ended in ${finalState})`)
  }
  return { finalState, transitions, verified: ok }
}

/**
 * Drive the reverse path Done → RollingBack → Pending. Used by the idempotency test
 * and by an operational rollback. The actor starts fresh in Pending, so we replay it
 * forward to Done first, then send the rollback events around `await rollback`.
 */
export async function rollbackMigration<Tx>(
  steps: MigrationSteps<Tx> & { rollback(tx: Tx): Promise<void> },
  opts: RunMigrationOptions,
): Promise<MigrationRunResult> {
  const sink = opts.sink ?? NOOP_TRANSITION_SINK
  const transitions: MigrationTransitionRecord[] = []
  const actor = createActor(migrationMachine)
  const send = makeSender(actor, opts.clock, sink, transitions)

  actor.start()
  // Replay forward to Done so the reverse transition is legal on the machine.
  send({ type: 'Start' })
  send({ type: 'BackfillCompleted' })
  send({ type: 'VerificationPassed' })
  send({ type: 'RollbackRequested' })
  await steps.rollback(steps.tx)
  send({ type: 'RollbackCompleted' })
  actor.stop()

  const finalState = (transitions.at(-1)?.to ?? 'Pending') as MigrationState
  return { finalState, transitions, verified: false }
}
