export {
  connectNats,
  ensureConsumer,
  ensureStream,
  type NatsHandle,
  QAROOM_STREAM,
} from './connection'
export { consumeDurable } from './consume-durable'
export { type ResilientConsumeOpts, runResilientConsume } from './consume-loop'
export { type BacklogSim, consumerStalled, simulateBacklog } from './consumer-lag'
export { connectServiceDb, dbReadiness, type ServiceDbHandle } from './db-connect'
export { alreadyProcessed, markProcessed } from './dedup'
export { createDrainLoop } from './drain-loop'
export { type GcSweep, type GcTargets, gcDedup } from './gc'
export { buildEventHeaders, headersToRecord, readEventHeaders } from './headers'
export {
  bodyHash,
  conflictingIdempotencyKey,
  findIdempotent,
  type StoredResponse,
  stableStringify,
  storeIdempotent,
} from './idempotency'
export { advisoryLock } from './locks'
export { outboxPublish } from './outbox'
export { natsPublisher } from './publish'
export { createRelay, type Relay } from './relay'
export {
  deliveryBudgetSettlement,
  type Settlement,
  settleByDeliveryBudget,
} from './settle'
export { pgSnapshotStore } from './snapshot-store'
export { type DeliveredEvent, type EventHandler, processEvent } from './subscribe'
export type { EventPublisher, OutboxEvent, PendingEvent, SqlExecutor, TxRunner } from './types'
export { HEADER, rowsOf } from './types'
