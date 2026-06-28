import {
  connectNats,
  connectServiceDb,
  createRelay,
  natsPublisher,
  QAROOM_STREAM,
} from '@qaroom/messaging'
import { intFromEnv, pgPoolMax, resolveBootDeps, runServer } from '@qaroom/service-kit'
import { buildApp } from './app'
import { startDonationsConsumer } from './consumer'
import { ensureSchema } from './db/migrate'
import { schema } from './db/schema'
import { startDonationsErasureConsumer } from './erasure'
import { createPaymentClient } from './payment-client'

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://qaroom:qaroom@localhost:5432/qaroom_donations'
const natsUrl = process.env.NATS_URL ?? 'nats://localhost:4222'
const paymentBaseUrl =
  process.env.PAYMENT_PROVIDER_BASE_URL ?? 'http://localhost:8080/rest/payments/1.0'
const port = intFromEnv('PORT', 8084)
const RELAY_INTERVAL_MS = 1000

// Replay reproduces committed state with no payment provider; live calls the real client.
const replayPayment = {
  charge: async () => ({ provider_ref: 'replay', status: 'declined' as const }),
}

// Snapshot-replay boot (Commitment 8): when replaying, the clock is pinned and the live-only wiring
// (NATS relay + flags consumer + payment client) is skipped; captured state arrives via POST.
runServer(
  async () => {
    const { deps, replaying } = resolveBootDeps()
    const { db, snapshotStore } = connectServiceDb({ connectionString, schema, max: pgPoolMax() })
    await ensureSchema(db)

    if (!replaying) {
      const nats = await connectNats(natsUrl)
      // Outbox relay drains donation-state events to JetStream (Commitment 17).
      createRelay({ db, publisher: natsPublisher(nats.js), clock: deps.clock }).start(
        RELAY_INTERVAL_MS,
      )
      // Consume flags-service events to keep the local gating cache current.
      await startDonationsConsumer(nats, QAROOM_STREAM, db, deps.clock)
      // Consume identity's `user.erased` events (GDPR erasure cascade, ADR-0036): delete the user's donations.
      await startDonationsErasureConsumer(nats, QAROOM_STREAM, db, deps.clock)
    }

    const payment = replaying ? replayPayment : createPaymentClient(paymentBaseUrl)
    return buildApp({ db, payment, snapshotStore, ...deps })
  },
  { port, name: 'donations-service' },
)
