import { connectNats, createRelay, natsPublisher, pgSnapshotStore } from '@qaroom/messaging'
import { intFromEnv, pgPoolMax, resolveBootDeps, runServer } from '@qaroom/service-kit'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { buildApp } from './app'
import { runContentBackfill } from './db/backfill'
import { ensureSchema } from './db/migrate'
import { schema } from './db/schema'

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://qaroom:qaroom@localhost:5432/qaroom_content'
const natsUrl = process.env.NATS_URL ?? 'nats://localhost:4222'
const port = intFromEnv('PORT', 8081)
const RELAY_INTERVAL_MS = 1000

// Snapshot-replay boot (Commitment 8): when replaying, the clock is pinned to the bundle's
// clock_seed and the live-only wiring (backfill, NATS relay) is skipped — the Docker Compose replay
// env has no NATS; captured state arrives via POST /system/snapshot.
runServer(
  async () => {
    const { deps, replaying } = resolveBootDeps()
    const sql = postgres(connectionString, { max: pgPoolMax() })
    const db = drizzle(sql, { schema })
    await ensureSchema(db)
    const snapshotStore = pgSnapshotStore(sql)

    if (!replaying) {
      // Communities-as-tenants (Milestone 2): normalize legacy community_id before serving.
      await runContentBackfill(db, { clock: deps.clock })
      // Transactional-outbox relay (Commitment 17): drain committed events to JetStream.
      const nats = await connectNats(natsUrl)
      const relay = createRelay({ db, publisher: natsPublisher(nats.js), clock: deps.clock })
      relay.start(RELAY_INTERVAL_MS)
      const app = await buildApp({ db, snapshotStore, ...deps })
      // CHAOS_SYNC_PUBLISH (deliberate-bug demo, failure-modes.md#02): drain the outbox ON the
      // request path before the response leaves, undoing Commitment 17's isolation — a slow
      // broker now stalls mutating HTTP. Invisible to every functional test (drain is a no-op
      // burden on a healthy broker); only chaos (slow NATS) × k6 (latency SLO) exposes it.
      if (process.env.CHAOS_SYNC_PUBLISH === '1') {
        app.addHook('onSend', async (request, _reply, payload) => {
          if (request.method !== 'GET') await relay.drainOnce()
          return payload
        })
      }
      return app
    }
    return buildApp({ db, snapshotStore, ...deps })
  },
  { port, name: 'content-service' },
)
