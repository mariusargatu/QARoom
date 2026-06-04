import {
  DONATION_STATE_CHANGED_EVENT,
  DONATION_STATE_CHANGED_VERSION,
  DonationStateChangedEvent,
  type DonationStatus,
  donationStateChanged,
} from '@qaroom/contracts'
import { advisoryLock, outboxPublish, rowsOf } from '@qaroom/messaging'
import { traced } from '@qaroom/otel'
import { desc, eq, sql } from 'drizzle-orm'
import type { DonationsDb, SqlExecutor } from './db/client'
import { donations } from './db/schema'
import type { RepoDeps } from './deps'

/** The well-known flag that gates donations. */
export const DONATIONS_FLAG = 'donations'

/** snake_case donation record matching the `Donation` contract; routes wrap/validate it. */
export interface DonationRecord {
  id: string
  community_id: string
  donor_id: string
  amount_cents: number
  currency: string
  status: DonationStatus
  created_at: string
  updated_at: string
}

export interface CreateDonationInput {
  communityId: string
  donorId: string
  amountCents: number
  currency: string
  /** The HTTP Idempotency-Key, forwarded to the payment provider. */
  idempotencyKey: string
}

/** A gated donation, a provider fault, or a recorded donation (captured or declined). */
export type CreateDonationResult =
  | { ok: true; donation: DonationRecord }
  | { ok: false; reason: 'gated' | 'payment_unavailable' }

/**
 * Upsert the cached enabled-state of a flag for a community. Called by the NATS consumer
 * (with a tx) on every `flag.state.changed`, and by tests to set up gating. Raw SQL so it
 * works through the consumer's `SqlExecutor` handle without the drizzle query builder.
 */
export async function setFlagEnabled(
  ex: SqlExecutor,
  communityId: string,
  flagKey: string,
  enabled: boolean,
  now: Date,
): Promise<void> {
  await ex.execute(sql`
    INSERT INTO flag_cache (community_id, flag_key, enabled, updated_at)
    VALUES (${communityId}, ${flagKey}, ${enabled}, ${now.toISOString()})
    ON CONFLICT (community_id, flag_key)
    DO UPDATE SET enabled = ${enabled}, updated_at = ${now.toISOString()}
  `)
}

/** Read whether the donations flag is enabled for a community (absent ⇒ not enabled). */
export async function isDonationsEnabled(db: DonationsDb, communityId: string): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT enabled FROM flag_cache WHERE community_id = ${communityId} AND flag_key = ${DONATIONS_FLAG} LIMIT 1`,
  )
  const rows = rowsOf<{ enabled: boolean }>(result)
  return rows[0]?.enabled ?? false
}

function rowToDonation(r: typeof donations.$inferSelect): DonationRecord {
  return {
    id: r.id,
    community_id: r.communityId,
    donor_id: r.donorId,
    amount_cents: r.amountCents,
    currency: r.currency,
    status: r.status as DonationStatus,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  }
}

/**
 * Create a donation. Gated by the cached `donations` flag (Milestone 5 feature gating); when
 * enabled, charges the (mocked) payment provider and records the outcome. A provider
 * fault (`charge` throws) surfaces as `payment_unavailable`; a decline is a recorded `Failed`
 * donation, not an error. The donation-state event is emitted through the transactional
 * outbox (Commitment 17) so the gateway's WS/poll feed sees it.
 */
export async function createDonation(
  db: DonationsDb,
  deps: RepoDeps,
  input: CreateDonationInput,
): Promise<CreateDonationResult> {
  return traced('db.donations.create', async () => {
    if (!(await isDonationsEnabled(db, input.communityId))) {
      return { ok: false, reason: 'gated' }
    }

    let authStatus: 'captured' | 'declined'
    try {
      const auth = await deps.payment.charge({
        amount_cents: input.amountCents,
        currency: input.currency,
        idempotency_key: input.idempotencyKey,
      })
      authStatus = auth.status
    } catch {
      return { ok: false, reason: 'payment_unavailable' }
    }

    const status: DonationStatus = authStatus === 'captured' ? 'Captured' : 'Failed'
    const now = deps.clock.now()
    const row = {
      id: deps.ids.next('dntn'),
      communityId: input.communityId,
      donorId: input.donorId,
      amountCents: input.amountCents,
      currency: input.currency,
      status,
      createdAt: now,
      updatedAt: now,
    }
    await db.transaction(async (tx) => {
      await advisoryLock(tx, row.id)
      await tx.insert(donations).values(row)
      const evt = DonationStateChangedEvent.parse({
        event_id: deps.ids.next('evt'),
        community_id: row.communityId,
        donation_id: row.id,
        donor_id: row.donorId,
        amount_cents: row.amountCents,
        currency: row.currency,
        status: row.status,
        occurred_at: now.toISOString(),
      })
      await outboxPublish(
        tx,
        {
          eventId: evt.event_id,
          subject: donationStateChanged(row.communityId),
          eventName: DONATION_STATE_CHANGED_EVENT,
          eventVersion: DONATION_STATE_CHANGED_VERSION,
          communityId: row.communityId,
          payload: evt,
        },
        now,
      )
    })
    deps.lamport.bump()
    return { ok: true, donation: rowToDonation(row) }
  })
}

export async function getDonation(
  db: DonationsDb,
  donationId: string,
): Promise<DonationRecord | null> {
  const rows = await db.select().from(donations).where(eq(donations.id, donationId)).limit(1)
  const r = rows[0]
  return r ? rowToDonation(r) : null
}

export async function listDonations(
  db: DonationsDb,
  communityId: string,
  limit = 50,
): Promise<DonationRecord[]> {
  const rows = await db
    .select()
    .from(donations)
    .where(eq(donations.communityId, communityId))
    .orderBy(desc(donations.createdAt))
    .limit(limit)
  return rows.map(rowToDonation)
}

export async function countDonations(db: DonationsDb): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)::int` }).from(donations)
  return rows[0]?.n ?? 0
}
