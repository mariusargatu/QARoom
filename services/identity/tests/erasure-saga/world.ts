import { PGlite } from '@electric-sql/pglite'
import { resolveFaults } from '@qaroom/content/config/faults'
import type { ContentDb } from '@qaroom/content/db/client'
import { ensureSchema as ensureContentSchema } from '@qaroom/content/db/migrate'
import {
  ERASURE_SUBSCRIPTION as CONTENT_ERASURE_SUB,
  userErasedHandler as contentErasureHandler,
  countUserFootprint as contentFootprint,
} from '@qaroom/content/erasure'
import {
  type ErasureParticipant,
  type ErasureSagaResult,
  LamportGate,
  runErasureSaga,
  USER_ERASED_FEED_SUBJECT,
} from '@qaroom/contracts'
import type { DonationsDb } from '@qaroom/donations/db/client'
import { ensureSchema as ensureDonationsSchema } from '@qaroom/donations/db/migrate'
import {
  ERASURE_SUBSCRIPTION as DONATIONS_ERASURE_SUB,
  userErasedHandler as donationsErasureHandler,
  countUserFootprint as donationsFootprint,
} from '@qaroom/donations/erasure'
import {
  createRelay,
  type EventHandler,
  processEvent,
  type Relay,
  readEventHeaders,
  type SqlExecutor,
  type TxRunner,
} from '@qaroom/messaging'
import { activeSpanSink } from '@qaroom/otel'
import { FakeClock, SeededIdGenerator } from '@qaroom/testing-utils/determinism'
import { type InMemoryBroker, inMemoryBroker } from '@qaroom/testing-utils/scenario'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import type { IdentityDb } from '../../src/db/client'
import { ensureSchema as ensureIdentitySchema } from '../../src/db/migrate'
import { eraseUser } from '../../src/repository'

/**
 * One IN-PROCESS composed world for the GDPR cross-service erasure saga (T14, ADR-0036). identity
 * (the saga orchestrator + outbox producer), content, and donations run in ONE process over a single
 * in-memory broker, THREE PGlite databases, and ONE virtual clock — the T22 cross-service DST pattern
 * reused for an erasure cascade. flags-service is a NAMED structural non-participant: it holds no
 * user-scoped rows (its tables are keyed by `(community_id, flag_key)`), so there is nothing to erase.
 *
 * The real production code under test: identity's `eraseUser` (delete + per-community outbox fan-out),
 * its real outbox relay, and content/donations' real `user.erased` handlers (delete + `processEvent`
 * dedup). Only the bus (in-memory), the clock (virtual), and the ids (seeded) are substituted — the
 * same Commitment-6 seams every other suite injects.
 */

const BASE_INSTANT = new Date('2026-06-28T00:00:00.000Z')

export interface ErasureIds {
  /** The user being erased. */
  user: string
  /** A second user whose data must survive erasure (the no-over-deletion control). */
  other: string
  c1: string
  c2: string
}

export interface ErasureWorld {
  clock: FakeClock
  broker: InMemoryBroker
  ids: ErasureIds
  identityDb: IdentityDb
  contentDb: ContentDb
  donationsDb: DonationsDb
  identityDeps: { clock: FakeClock; ids: SeededIdGenerator; lamport: LamportGate }
  relay: Relay
  close(): Promise<void>
}

/** Build a fresh composed world and seed user `U`'s footprint across content + donations. */
export async function setupErasureWorld(seed = 1): Promise<ErasureWorld> {
  const clock = new FakeClock(BASE_INSTANT)
  const broker = inMemoryBroker()
  const gen = new SeededIdGenerator(seed)

  const ids: ErasureIds = {
    user: gen.next('user'),
    other: gen.next('user'),
    c1: gen.next('comm'),
    c2: gen.next('comm'),
  }
  const p1 = gen.next('post')
  const p2 = gen.next('post')
  const pOther = gen.next('post')
  const d1 = gen.next('dntn')

  // --- identity (orchestrator + producer) ---
  const identityPglite = new PGlite()
  const rawIdentityDb = drizzle(identityPglite)
  const identityDb = rawIdentityDb as unknown as IdentityDb
  await ensureIdentitySchema(rawIdentityDb as unknown as SqlExecutor)
  await rawIdentityDb.execute(sql`
    INSERT INTO users (id, handle, display_name, created_at) VALUES
      (${ids.user}, 'erase_me', 'Erase Me', ${BASE_INSTANT.toISOString()}),
      (${ids.other}, 'keep_me', 'Keep Me', ${BASE_INSTANT.toISOString()})
  `)
  await rawIdentityDb.execute(sql`
    INSERT INTO memberships (user_id, community_id, role, joined_at) VALUES
      (${ids.user}, ${ids.c1}, 'member', ${BASE_INSTANT.toISOString()}),
      (${ids.user}, ${ids.c2}, 'member', ${BASE_INSTANT.toISOString()})
  `)

  // --- content ---
  const contentPglite = new PGlite()
  const rawContentDb = drizzle(contentPglite)
  const contentDb = rawContentDb as unknown as ContentDb
  await ensureContentSchema(rawContentDb as unknown as SqlExecutor)
  await rawContentDb.execute(sql`
    INSERT INTO posts (id, community_id, author_id, title, body, score, created_at) VALUES
      (${p1}, ${ids.c1}, ${ids.user}, 't1', 'b1', 0, ${BASE_INSTANT.toISOString()}),
      (${p2}, ${ids.c2}, ${ids.user}, 't2', 'b2', 0, ${BASE_INSTANT.toISOString()}),
      (${pOther}, ${ids.c1}, ${ids.other}, 't3', 'b3', 0, ${BASE_INSTANT.toISOString()})
  `)
  // U votes on its own post (p1) and on another user's post (pOther) — both in C1. `other` also votes.
  await rawContentDb.execute(sql`
    INSERT INTO votes (post_id, voter_id, value, created_at) VALUES
      (${p1}, ${ids.user}, 1, ${BASE_INSTANT.toISOString()}),
      (${pOther}, ${ids.user}, 1, ${BASE_INSTANT.toISOString()}),
      (${p1}, ${ids.other}, 1, ${BASE_INSTANT.toISOString()})
  `)

  // --- donations ---
  const donationsPglite = new PGlite()
  const rawDonationsDb = drizzle(donationsPglite)
  const donationsDb = rawDonationsDb as unknown as DonationsDb
  await ensureDonationsSchema(rawDonationsDb as unknown as SqlExecutor)
  await rawDonationsDb.execute(sql`
    INSERT INTO donations (id, community_id, donor_id, amount_cents, currency, status, created_at, updated_at) VALUES
      (${d1}, ${ids.c1}, ${ids.user}, 500, 'usd', 'succeeded', ${BASE_INSTANT.toISOString()}, ${BASE_INSTANT.toISOString()})
  `)

  const identityDeps = {
    clock,
    ids: gen,
    lamport: new LamportGate(gen, activeSpanSink),
  }
  const relay = createRelay({
    db: rawIdentityDb as unknown as TxRunner,
    publisher: broker.publisher,
    clock,
  })
  broker.registerDurable({
    durable: CONTENT_ERASURE_SUB,
    filterSubjects: [USER_ERASED_FEED_SUBJECT],
  })
  broker.registerDurable({
    durable: DONATIONS_ERASURE_SUB,
    filterSubjects: [USER_ERASED_FEED_SUBJECT],
  })

  return {
    clock,
    broker,
    ids,
    identityDb,
    contentDb,
    donationsDb,
    identityDeps,
    relay,
    async close() {
      await identityPglite.close()
      await contentPglite.close()
      await donationsPglite.close()
    },
  }
}

/**
 * Drain a downstream durable once and apply each delivered `user.erased` event through `processEvent`
 * (dedup + tenant scope), acking it. `ack` is skipped when `leaveUnacked` is set — the at-least-once
 * redelivery the dedup test exercises. Returns how many events were processed this pass.
 */
async function drainDurable(
  world: ErasureWorld,
  durable: string,
  db: SqlExecutor,
  handler: EventHandler,
  opts: { leaveUnacked?: boolean } = {},
): Promise<number> {
  const messages = world.broker.poll(durable)
  for (const message of messages) {
    const meta = readEventHeaders(message.headers)
    await processEvent(
      db as unknown as TxRunner,
      durable,
      { eventId: meta.eventId, communityId: meta.communityId, payload: message.payload },
      handler,
      world.clock,
    )
    if (!opts.leaveUnacked) world.broker.ack(durable, message.seq)
  }
  return messages.length
}

export interface FootprintReport {
  identityUser: boolean
  content: number
  donations: number
  /** The control user's content footprint — must be unchanged by U's erasure. */
  otherContent: number
}

/** Snapshot whether each service still returns the erased user (the claim's observation surface). */
export async function footprints(world: ErasureWorld): Promise<FootprintReport> {
  const userRow = await world.identityDb
    .execute(sql`SELECT 1 AS x FROM users WHERE id = ${world.ids.user}`)
    .then((r) => (r as unknown as { rows: unknown[] }).rows.length > 0)
  return {
    identityUser: userRow,
    content: await contentFootprint(world.contentDb as unknown as SqlExecutor, world.ids.user),
    donations: await donationsFootprint(
      world.donationsDb as unknown as SqlExecutor,
      world.ids.user,
    ),
    otherContent: await contentFootprint(
      world.contentDb as unknown as SqlExecutor,
      world.ids.other,
    ),
  }
}

/**
 * Run the erasure end-to-end: identity erases its rows + stages the per-community events, the relay
 * publishes them, then the saga drives content + donations to delete their slice and confirm. content's
 * handler is built from `resolveFaults()` so the `CONTENT_BUG_SKIP_ERASURE` toggle (prove --break)
 * flows in. `leaveContentUnacked` re-delivers content's events for the dedup test. Returns the saga
 * result so the per-service completion tracking is observable.
 */
export async function runErasure(
  world: ErasureWorld,
  opts: { leaveContentUnacked?: boolean } = {},
): Promise<ErasureSagaResult> {
  await eraseUser(world.identityDb, world.identityDeps, world.ids.user)
  await world.relay.drainOnce()

  const contentHandler = contentErasureHandler(resolveFaults())
  const donationsHandler = donationsErasureHandler()

  const participants: ErasureParticipant[] = [
    {
      service: 'content',
      erase: async () => {
        const processed = await drainDurable(
          world,
          CONTENT_ERASURE_SUB,
          world.contentDb as unknown as SqlExecutor,
          contentHandler,
          { leaveUnacked: opts.leaveContentUnacked },
        )
        const remaining = await contentFootprint(
          world.contentDb as unknown as SqlExecutor,
          world.ids.user,
        )
        return { confirmed: remaining === 0, rowsDeleted: processed }
      },
    },
    {
      service: 'donations',
      erase: async () => {
        const processed = await drainDurable(
          world,
          DONATIONS_ERASURE_SUB,
          world.donationsDb as unknown as SqlExecutor,
          donationsHandler,
        )
        const remaining = await donationsFootprint(
          world.donationsDb as unknown as SqlExecutor,
          world.ids.user,
        )
        return { confirmed: remaining === 0, rowsDeleted: processed }
      },
    },
  ]

  return runErasureSaga(participants, { clock: world.clock })
}
