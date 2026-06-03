import { connectNats, createRelay, natsPublisher } from '@qaroom/messaging'
import { createProductionDeps, runServer } from '@qaroom/service-kit'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { buildApp } from './app'
import { runContentBackfill } from './db/backfill'
import { ensureSchema } from './db/migrate'
import { schema } from './db/schema'

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://qaroom:qaroom@localhost:5432/qaroom_content'
const natsUrl = process.env.NATS_URL ?? 'nats://localhost:4222'
const port = Number(process.env.PORT ?? 8081)
const RELAY_INTERVAL_MS = 1000

runServer(
  async () => {
    const deps = createProductionDeps()
    const db = drizzle(postgres(connectionString), { schema })
    await ensureSchema(db)
    // Communities-as-tenants (Milestone 2): normalize any legacy community_id to the
    // general community before serving. Modeled as a state machine; see db/backfill.ts.
    await runContentBackfill(db, { clock: deps.clock })
    // Transactional-outbox relay (Commitment 17): drain committed events to JetStream.
    // The HTTP path only writes the outbox row, so it serves even if NATS is briefly down;
    // the relay's per-row retry (at-least-once) catches up when the broker returns.
    const nats = await connectNats(natsUrl)
    createRelay({ db, publisher: natsPublisher(nats.js), clock: deps.clock }).start(
      RELAY_INTERVAL_MS,
    )
    return buildApp({ db, ...deps })
  },
  { port, name: 'content-service' },
)
