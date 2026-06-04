import { connectNats, createRelay, natsPublisher, QAROOM_STREAM } from '@qaroom/messaging'
import { createProductionDeps, runServer } from '@qaroom/service-kit'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { buildApp } from './app'
import { startDonationsConsumer } from './consumer'
import { ensureSchema } from './db/migrate'
import { schema } from './db/schema'
import { createPaymentClient } from './payment-client'

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://qaroom:qaroom@localhost:5432/qaroom_donations'
const natsUrl = process.env.NATS_URL ?? 'nats://localhost:4222'
const paymentBaseUrl =
  process.env.PAYMENT_PROVIDER_BASE_URL ?? 'http://localhost:8080/rest/payments/1.0'
const port = Number(process.env.PORT ?? 8084)
const RELAY_INTERVAL_MS = 1000

runServer(
  async () => {
    const deps = createProductionDeps()
    const db = drizzle(postgres(connectionString), { schema })
    await ensureSchema(db)

    const nats = await connectNats(natsUrl)
    // Outbox relay drains donation-state events to JetStream (Commitment 17).
    createRelay({ db, publisher: natsPublisher(nats.js), clock: deps.clock }).start(
      RELAY_INTERVAL_MS,
    )
    // Consume flags-service events to keep the local gating cache current.
    await startDonationsConsumer(nats.js, QAROOM_STREAM, db, deps.clock)

    return buildApp({ db, payment: createPaymentClient(paymentBaseUrl), ...deps })
  },
  { port, name: 'donations-service' },
)
