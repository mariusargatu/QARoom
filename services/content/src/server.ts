import { createProductionDeps, runServer } from '@qaroom/service-kit'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { buildApp } from './app'
import { runContentBackfill } from './db/backfill'
import { ensureSchema } from './db/migrate'
import { schema } from './db/schema'

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://qaroom:qaroom@localhost:5432/qaroom_content'
const port = Number(process.env.PORT ?? 8081)

runServer(
  async () => {
    const deps = createProductionDeps()
    const db = drizzle(postgres(connectionString), { schema })
    await ensureSchema(db)
    // Communities-as-tenants (Milestone 2): normalize any legacy community_id to the
    // general community before serving. Modeled as a state machine; see db/backfill.ts.
    await runContentBackfill(db, { clock: deps.clock })
    return buildApp({ db, ...deps })
  },
  { port, name: 'content-service' },
)
