import type { LamportGate } from '@qaroom/contracts'
import type { Clock, IdGenerator, Randomness } from '@qaroom/determinism'
import type { ContentDb } from './db/client'

/** What `buildApp` receives. `lamport` is optional; the app creates one if absent. */
export interface ContentDeps {
  db: ContentDb
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  lamport?: LamportGate
}

/** What route handlers receive: every dependency resolved, including the gate. */
export interface RouteDeps {
  db: ContentDb
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  lamport: LamportGate
}

/** Subset the repository needs to mint ids, stamp time, and advance the gate. */
export interface RepoDeps {
  clock: Clock
  ids: IdGenerator
  lamport: LamportGate
}
