import {
  type ApplyEventOptions,
  type ApplyEventResult,
  applyMachineEvent,
  type TransitionRecord,
  type TransitionSink,
} from './apply-event'
import { type RolloutEvent, type RolloutState, rolloutMachine } from './rollout.machine'

export type RolloutTransitionRecord = TransitionRecord<RolloutState, RolloutEvent['type']>
export type RolloutTransitionSink = TransitionSink<RolloutState, RolloutEvent['type']>
export type ApplyRolloutOptions = ApplyEventOptions<RolloutState, RolloutEvent['type']>
export type RolloutApplyResult = ApplyEventResult<RolloutState, RolloutEvent['type']>

/**
 * Apply a single rollout event — see {@link applyMachineEvent}. An illegal event leaves the
 * state unchanged (`changed: false`), which flags-service maps to a 409 conflict.
 */
export function applyRolloutEvent(
  currentState: RolloutState,
  event: RolloutEvent['type'],
  opts: ApplyRolloutOptions,
): RolloutApplyResult {
  return applyMachineEvent(rolloutMachine, currentState, event, opts)
}
