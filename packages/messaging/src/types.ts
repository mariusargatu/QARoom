import type { SQL } from 'drizzle-orm'

/** Minimal raw-SQL surface (mirrors each service's `SqlExecutor`) — a db or a tx. */
export interface SqlExecutor {
  execute(query: SQL): Promise<unknown>
}

/**
 * A db that can open a transaction whose handle is a `SqlExecutor`. Both
 * `PostgresJsDatabase` (production) and `PgliteDatabase` (tests) satisfy this, so the SDK
 * stays driver-agnostic — the same decoupling the services use for migrations/locks.
 */
export interface TxRunner {
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>
}

/**
 * NATS header names QARoom sets on every message. `Nats-Msg-Id` drives JetStream
 * `duplicate_window` dedup (Commitment 17); `tenant.id` carries the community so the
 * consumer can re-enter the tenant span scope.
 */
export const HEADER = {
  msgId: 'Nats-Msg-Id',
  tenant: 'tenant.id',
  eventName: 'event-name',
  eventVersion: 'event-version',
} as const

/** A domain event ready to publish. `eventId` is the `evt_<ulid>` used as the Msg-Id. */
export interface OutboxEvent {
  eventId: string
  subject: string
  eventName: string
  eventVersion: number
  communityId: string
  payload: unknown
}

/** A pending outbox row as the relay reads it; `traceContext` is restored on publish. */
export interface PendingEvent {
  eventId: string
  subject: string
  eventName: string
  eventVersion: number
  communityId: string
  payload: unknown
  traceContext: Record<string, string>
}

/**
 * Publishes an event to the broker. The NATS implementation wraps JetStream; tests use a
 * recording double, so the relay's drain logic runs without a broker in the loop.
 */
export interface EventPublisher {
  publish(subject: string, payload: unknown, headers: Record<string, string>): Promise<void>
}

/**
 * Normalize the cross-driver shape of `SqlExecutor.execute`: postgres-js returns a row
 * array, pglite returns `{ rows }`. Reads in the SDK go through here so a raw `sql` query
 * works identically under both drivers.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  if (result && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: T[] }).rows
  }
  return []
}
