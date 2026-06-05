import {
  generateWebhookSecret,
  type WebhookDeliveryStatus,
  type WebhookEventType,
  type WebhookSubscriptionStatus,
} from '@qaroom/contracts'
import { advisoryLock, rowsOf, type SqlExecutor } from '@qaroom/messaging'
import { traced } from '@qaroom/otel'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { WebhooksDb } from './db/client'
import { webhookDeliveries, webhookSubscriptions } from './db/schema'
import type { RepoDeps } from './deps'

/** snake_case subscription record matching the `WebhookSubscription` contract (no secret). */
export interface WebhookSubscriptionRecord {
  id: string
  community_id: string
  url: string
  event_types: WebhookEventType[]
  status: WebhookSubscriptionStatus
  created_at: string
  updated_at: string
}

/** The create-only shape: the subscription plus its write-once signing secret. */
export interface WebhookSubscriptionWithSecretRecord extends WebhookSubscriptionRecord {
  secret: string
}

export interface CreateSubscriptionInput {
  communityId: string
  url: string
  eventTypes: WebhookEventType[]
}

/** Active↔Paused is the operator toggle; an illegal transition surfaces as 409. */
export type StatusTransitionResult =
  | { ok: true; subscription: WebhookSubscriptionRecord }
  | { ok: false; reason: 'not_found' | 'illegal' }

function rowToSubscription(r: typeof webhookSubscriptions.$inferSelect): WebhookSubscriptionRecord {
  return {
    id: r.id,
    community_id: r.communityId,
    url: r.url,
    event_types: r.eventTypes as WebhookEventType[],
    status: r.status as WebhookSubscriptionStatus,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  }
}

/** Register a new subscription. Returns the record WITH its secret (the only time it is revealed). */
export async function createSubscription(
  db: WebhooksDb,
  deps: RepoDeps,
  input: CreateSubscriptionInput,
): Promise<WebhookSubscriptionWithSecretRecord> {
  return traced('db.webhooks.createSubscription', async () => {
    const now = deps.clock.now()
    const row = {
      id: deps.ids.next('whsub'),
      communityId: input.communityId,
      url: input.url,
      secret: generateWebhookSecret(deps.randomness),
      eventTypes: input.eventTypes,
      status: 'Active' satisfies WebhookSubscriptionStatus,
      consecutiveDeadLetters: 0,
      createdAt: now,
      updatedAt: now,
    }
    await db.transaction(async (tx) => {
      await advisoryLock(tx, row.id)
      await tx.insert(webhookSubscriptions).values(row)
    })
    deps.lamport.bump()
    return { ...rowToSubscription(row), secret: row.secret }
  })
}

export async function getSubscription(
  db: WebhooksDb,
  subscriptionId: string,
): Promise<WebhookSubscriptionRecord | null> {
  const rows = await db
    .select()
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.id, subscriptionId))
    .limit(1)
  const r = rows[0]
  return r ? rowToSubscription(r) : null
}

export async function listSubscriptions(
  db: WebhooksDb,
  communityId: string,
): Promise<WebhookSubscriptionRecord[]> {
  const rows = await db
    .select()
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.communityId, communityId))
  return rows.map(rowToSubscription)
}

/** Tenant-scoped delete. Returns whether a subscription was found (and removed). */
export async function deleteSubscription(
  db: WebhooksDb,
  communityId: string,
  subscriptionId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(webhookSubscriptions)
    .where(
      and(
        eq(webhookSubscriptions.id, subscriptionId),
        eq(webhookSubscriptions.communityId, communityId),
      ),
    )
    .returning({ id: webhookSubscriptions.id })
  return deleted.length > 0
}

/** Pause an Active subscription (Active→Paused). Resume reverses (Paused→Active). */
export async function setSubscriptionStatus(
  db: WebhooksDb,
  deps: RepoDeps,
  communityId: string,
  subscriptionId: string,
  target: 'Active' | 'Paused',
): Promise<StatusTransitionResult> {
  const current = await getSubscription(db, subscriptionId)
  if (!current || current.community_id !== communityId) return { ok: false, reason: 'not_found' }
  // Legal toggles only: pause requires Active, resume requires Paused. A Disabled subscription
  // (auto-quarantined after repeated dead-letters) cannot be toggled back here.
  const legal =
    (target === 'Paused' && current.status === 'Active') ||
    (target === 'Active' && current.status === 'Paused')
  if (!legal) return { ok: false, reason: 'illegal' }
  const now = deps.clock.now()
  const updated = await db
    .update(webhookSubscriptions)
    .set({ status: target, updatedAt: now })
    .where(eq(webhookSubscriptions.id, subscriptionId))
    .returning()
  deps.lamport.bump()
  const r = updated[0]
  return r ? { ok: true, subscription: rowToSubscription(r) } : { ok: false, reason: 'not_found' }
}

/**
 * Active subscriptions in a community subscribed to `eventType`. Raw SQL so it runs through the
 * consumer's `SqlExecutor` transaction (no drizzle query builder there). Used by the fan-out.
 */
export async function activeSubscriptionsFor(
  ex: SqlExecutor,
  communityId: string,
  eventType: WebhookEventType,
): Promise<Array<{ id: string }>> {
  const result = await ex.execute(sql`
    SELECT id FROM webhook_subscriptions
    WHERE community_id = ${communityId}
      AND status = 'Active'
      AND ${eventType} = ANY(event_types)
  `)
  return rowsOf<{ id: string }>(result)
}

/**
 * Insert a Pending delivery, due immediately. `ON CONFLICT (subscription_id, event_id) DO NOTHING`
 * makes the fan-out idempotent under JetStream redelivery (the per-target at-least-once boundary).
 */
export async function insertPendingDelivery(
  ex: SqlExecutor,
  input: {
    id: string
    subscriptionId: string
    communityId: string
    eventId: string
    eventType: WebhookEventType
    payload: unknown
    now: Date
  },
): Promise<void> {
  const iso = input.now.toISOString()
  await ex.execute(sql`
    INSERT INTO webhook_deliveries
      (id, subscription_id, community_id, event_id, event_type, payload, status, attempt, next_attempt_at, created_at, updated_at)
    VALUES
      (${input.id}, ${input.subscriptionId}, ${input.communityId}, ${input.eventId}, ${input.eventType},
       ${JSON.stringify(input.payload)}::jsonb, 'Pending', 0, ${iso}::timestamptz, ${iso}::timestamptz, ${iso}::timestamptz)
    ON CONFLICT (subscription_id, event_id) DO NOTHING
  `)
}

/** snake_case delivery record matching the `WebhookDelivery` contract. */
export interface WebhookDeliveryRecord {
  id: string
  subscription_id: string
  community_id: string
  event_id: string
  event_type: WebhookEventType
  status: WebhookDeliveryStatus
  attempt: number
  next_attempt_at: string | null
  last_status_code: number | null
  created_at: string
  updated_at: string
}

function rowToDelivery(r: typeof webhookDeliveries.$inferSelect): WebhookDeliveryRecord {
  return {
    id: r.id,
    subscription_id: r.subscriptionId,
    community_id: r.communityId,
    event_id: r.eventId,
    event_type: r.eventType as WebhookEventType,
    status: r.status as WebhookDeliveryStatus,
    attempt: r.attempt,
    next_attempt_at: r.nextAttemptAt ? r.nextAttemptAt.toISOString() : null,
    last_status_code: r.lastStatusCode ?? null,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  }
}

/** List a subscription's deliveries, newest first. */
export async function listDeliveries(
  db: WebhooksDb,
  subscriptionId: string,
  limit = 50,
): Promise<WebhookDeliveryRecord[]> {
  const rows = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.subscriptionId, subscriptionId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit)
  return rows.map(rowToDelivery)
}

/** Count subscriptions per community (for /system/state). */
export async function countSubscriptions(db: WebhooksDb): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)::int` }).from(webhookSubscriptions)
  return rows[0]?.n ?? 0
}

/** Count deliveries grouped by status (for /system/state). */
export async function countDeliveriesByStatus(
  db: WebhooksDb,
): Promise<Record<WebhookDeliveryStatus, number>> {
  const rows = await db
    .select({ status: webhookDeliveries.status, n: sql<number>`count(*)::int` })
    .from(webhookDeliveries)
    .groupBy(webhookDeliveries.status)
  const counts: Record<WebhookDeliveryStatus, number> = {
    Pending: 0,
    Delivering: 0,
    Delivered: 0,
    Retrying: 0,
    DeadLettered: 0,
  }
  for (const r of rows) {
    counts[r.status as WebhookDeliveryStatus] = r.n
  }
  return counts
}
