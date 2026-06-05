import type {
  LamportGate,
  SpanAttributeSink,
  WebhookDeliveryTransitionSink,
} from '@qaroom/contracts'
import type { Clock, IdGenerator, Randomness } from '@qaroom/determinism'
import type { SnapshotStore } from '@qaroom/service-kit'
import type { WebhooksDb } from './db/client'
import type { WebhookSender } from './sender'

/** What `buildApp` receives — the HTTP surface only. The delivery seams (`sender`, `deliverySink`)
 * live on `WorkerDeps`: the worker is wired separately in `server.ts`, never by `buildApp`. */
export interface WebhooksDeps {
  db: WebhooksDb
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  lamport?: LamportGate
  sink?: SpanAttributeSink
  /** Scenario-replay store (Commitment 8). When present, /system/snapshot is registered. */
  snapshotStore?: SnapshotStore
}

/** What route handlers receive: every dependency resolved. */
export interface RouteDeps {
  db: WebhooksDb
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  lamport: LamportGate
}

/** Subset the subscription repository needs. */
export interface RepoDeps {
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  lamport: LamportGate
}

/** Subset the delivery worker needs. */
export interface WorkerDeps {
  db: WebhooksDb
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  sender: WebhookSender
  deliverySink?: WebhookDeliveryTransitionSink
}
