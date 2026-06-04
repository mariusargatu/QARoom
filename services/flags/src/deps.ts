import type { LamportGate, RolloutTransitionSink, SpanAttributeSink } from '@qaroom/contracts'
import type { Clock, IdGenerator, Randomness } from '@qaroom/determinism'
import type { FlagsDb } from './db/client'

/** What `buildApp` receives. `lamport` and the sinks are optional; the app supplies defaults. */
export interface FlagsDeps {
  db: FlagsDb
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  lamport?: LamportGate
  /** Span-attribute sink for the LamportGate; defaults to the active-span bridge. */
  sink?: SpanAttributeSink
  /**
   * Sink each rollout transition is recorded to. Defaults to the OTel `xstate.transition`
   * span emitter; tests inject a recording sink to assert the transition directly.
   */
  transitionSink?: RolloutTransitionSink
}

/** What route handlers receive: every dependency resolved. */
export interface RouteDeps {
  db: FlagsDb
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  lamport: LamportGate
  transitionSink: RolloutTransitionSink
}

/** Subset the repository needs to mint ids, stamp time, advance the gate, and record transitions. */
export interface RepoDeps {
  clock: Clock
  ids: IdGenerator
  lamport: LamportGate
  transitionSink: RolloutTransitionSink
}
