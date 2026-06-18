import { connectNats, connectServiceDb, createRelay, natsPublisher } from '@qaroom/messaging'
import { intFromEnv, pgPoolMax, resolveBootDeps, runServer } from '@qaroom/service-kit'
import { buildApp } from './app'
import { ensureSchema } from './db/migrate'
import { schema } from './db/schema'

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://qaroom:qaroom@localhost:5432/qaroom_flags'
const natsUrl = process.env.NATS_URL ?? 'nats://localhost:4222'
const port = intFromEnv('PORT', 8083)
const RELAY_INTERVAL_MS = 1000

// Snapshot-replay boot (Commitment 8): when replaying, the clock is pinned and the NATS relay is
// skipped (the replay env has no broker); captured state arrives via POST /system/snapshot.
runServer(
  async () => {
    const { deps, replaying } = resolveBootDeps()
    const { db, snapshotStore } = connectServiceDb({ connectionString, schema, max: pgPoolMax() })
    await ensureSchema(db)

    if (!replaying) {
      // Transactional-outbox relay (Commitment 17): drain committed flag-changed events to
      // JetStream. Once booted, the HTTP path only writes the outbox row, so a broker outage
      // degrades publishing, not serving; the relay's per-row retry catches up when the broker
      // returns. At boot, though, connectNats has no retry: NATS down means crash-and-restart —
      // the intended posture (k8s restart semantics). Only webhooks fail-softs its broker
      // wiring at boot.
      const nats = await connectNats(natsUrl)
      createRelay({ db, publisher: natsPublisher(nats.js), clock: deps.clock }).start(
        RELAY_INTERVAL_MS,
      )
    }
    return buildApp({ db, snapshotStore, ...deps })
  },
  { port, name: 'flags-service' },
)
