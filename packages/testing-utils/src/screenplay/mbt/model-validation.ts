import type { AnyStateMachine } from 'xstate'

/**
 * The model-validation check (Milestone 5): a single assertion run at the start of any MBT
 * suite that the system the tests drive actually matches the model the paths come from. It
 * catches the silent-divergence failure where the model and the system drift apart and the
 * generated paths quietly stop meaning anything. Two invariants: the system's reported initial
 * state equals the model's initial state, and every event the model can emit has a
 * corresponding system endpoint to drive it.
 */

/** The top-level state names a flat machine declares. */
export function modeledStates(machine: AnyStateMachine): string[] {
  return Object.keys(machine.config.states ?? {})
}

/** The model's initial state name. */
function modeledInitialState(machine: AnyStateMachine): string {
  const initial = machine.config.initial
  if (typeof initial !== 'string') {
    throw new Error(
      'model-validation supports only a string initial state (flat, context-free machine)',
    )
  }
  return initial
}

/** Every distinct event name that appears on any state's `on` map. */
function modeledEvents(machine: AnyStateMachine): string[] {
  const events = new Set<string>()
  for (const state of Object.values(machine.config.states ?? {})) {
    const on = (state as { on?: Record<string, unknown> }).on ?? {}
    for (const eventName of Object.keys(on)) events.add(eventName)
  }
  return [...events].sort()
}

export interface SystemUnderTest {
  /** The state the system reports before any event (e.g. from `/system/state`). */
  initialState: string
  /** Event names the system exposes an endpoint for. */
  supportedEvents: readonly string[]
}

/**
 * Assert the model and the system agree. Throws on the first divergence with a message that
 * names exactly what differs — the failure localizes to a state or a missing endpoint.
 */
export function assertModelMatchesSystem(machine: AnyStateMachine, system: SystemUnderTest): void {
  const modelInitial = modeledInitialState(machine)
  if (modelInitial !== system.initialState) {
    throw new Error(
      `model/system initial-state mismatch: model starts at "${modelInitial}", system reports "${system.initialState}"`,
    )
  }
  const supported = new Set(system.supportedEvents)
  const missing = modeledEvents(machine).filter((e) => !supported.has(e))
  if (missing.length > 0) {
    throw new Error(
      `model events with no system endpoint: ${missing.join(', ')} — every modeled event must be drivable`,
    )
  }
}
