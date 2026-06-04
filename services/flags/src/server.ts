import { connectNats, createRelay, natsPublisher } from '@qaroom/messaging'
import { createProductionDeps, pgPoolMax, runServer } from '@qaroom/service-kit'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { buildApp } from './app'
import { ensureSchema } from './db/migrate'
import { schema } from './db/schema'

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://qaroom:qaroom@localhost:5432/qaroom_flags'
const natsUrl = process.env.NATS_URL ?? 'nats://localhost:4222'
const port = Number(process.env.PORT ?? 8083)
const RELAY_INTERVAL_MS = 1000

runServer(
  async () => {
    const deps = createProductionDeps()
    const db = drizzle(postgres(connectionString, { max: pgPoolMax() }), { schema })
    await ensureSchema(db)
    // Transactional-outbox relay (Commitment 17): drain committed flag-changed events to
    // JetStream. The HTTP path only writes the outbox row, so it serves even if NATS is
    // briefly down; the relay's per-row retry catches up when the broker returns.
    const nats = await connectNats(natsUrl)
    createRelay({ db, publisher: natsPublisher(nats.js), clock: deps.clock }).start(
      RELAY_INTERVAL_MS,
    )
    return buildApp({ db, ...deps })
  },
  { port, name: 'flags-service' },
)
