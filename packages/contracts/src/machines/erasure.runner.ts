import type { Clock } from '@qaroom/determinism'
import { createActor } from 'xstate'
import { NOOP_TRANSITION_SINK, type TransitionRecord, type TransitionSink } from './apply-event'
import { type ErasureEvent, type ErasureState, erasureMachine } from './erasure.machine'

export type ErasureTransitionRecord = TransitionRecord<ErasureState, ErasureEvent['type']>
export type ErasureTransitionSink = TransitionSink<ErasureState, ErasureEvent['type']>

/**
 * One participant in the erasure cascade: a downstream service that must delete its slice of the
 * user. `erase` performs the deletion (consume the `user.erased` events, delete rows, dedup) and
 * returns whether the service has CONFIRMED — its footprint for that user is now zero. Confirmation,
 * not "the handler ran", is the saga's completion signal: a service whose handler is disabled (the
 * `CONTENT_BUG_SKIP_ERASURE` demo) runs but does not confirm, so the saga reaches `Incomplete`.
 */
export interface ErasureParticipant {
  service: string
  erase(): Promise<{ confirmed: boolean; rowsDeleted: number }>
}

export interface RunErasureSagaOptions {
  clock: Clock
  sink?: ErasureTransitionSink
}

export interface ParticipantOutcome {
  service: string
  confirmed: boolean
  rowsDeleted: number
}

export interface ErasureSagaResult {
  finalState: ErasureState
  transitions: readonly ErasureTransitionRecord[]
  /** Per-service completion — the saga's tracking surface (which service did or did not confirm). */
  perService: readonly ParticipantOutcome[]
  /** True iff every participant confirmed (finalState === 'Erased'). */
  complete: boolean
}

/** Send an event through the actor, recording the (from, to, event) transition with a clock stamp. */
function makeSender(
  actor: ReturnType<typeof createActor<typeof erasureMachine>>,
  clock: Clock,
  sink: ErasureTransitionSink,
  transitions: ErasureTransitionRecord[],
) {
  return (event: ErasureEvent): void => {
    const from = actor.getSnapshot().value as ErasureState
    actor.send(event)
    const to = actor.getSnapshot().value as ErasureState
    const record: ErasureTransitionRecord = {
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
 * Drive `erasureMachine` Requested → Cascading → (Erased | Incomplete), invoking each participant's
 * `erase` between transitions and recording every transition with an injected clock stamp. The
 * machine stays side-effect-free; ALL I/O happens in the participants and here.
 *
 *   Requested --Start--> Cascading                       (then: await every participant.erase())
 *   Cascading --CascadeConfirmed--> Erased               (every participant confirmed)
 *   Cascading --CascadeIncomplete--> Incomplete          (≥1 did not — a disabled handler / a loss)
 *
 * Per-service outcomes are returned so the caller can see WHICH service blocked completion — the
 * tracking the saga exists to provide. Participants run in declaration order (deterministic); each
 * is independent, so an earlier failure never short-circuits a later one (every slice is attempted).
 */
export async function runErasureSaga(
  participants: readonly ErasureParticipant[],
  opts: RunErasureSagaOptions,
): Promise<ErasureSagaResult> {
  const sink = opts.sink ?? (NOOP_TRANSITION_SINK as ErasureTransitionSink)
  const transitions: ErasureTransitionRecord[] = []
  const actor = createActor(erasureMachine)
  const send = makeSender(actor, opts.clock, sink, transitions)

  actor.start()
  send({ type: 'Start' })

  const perService: ParticipantOutcome[] = []
  for (const participant of participants) {
    const outcome = await participant.erase()
    perService.push({ service: participant.service, ...outcome })
  }

  const allConfirmed = perService.every((p) => p.confirmed)
  send({ type: allConfirmed ? 'CascadeConfirmed' : 'CascadeIncomplete' })
  actor.stop()

  const finalState = (transitions.at(-1)?.to ?? 'Requested') as ErasureState
  return { finalState, transitions, perService, complete: allConfirmed }
}
