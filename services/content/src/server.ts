import { createProductionDeps, runServer } from '@qaroom/service-kit'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { buildApp } from './app'
import { ensureSchema } from './db/migrate'
import { schema } from './db/schema'

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://qaroom:qaroom@localhost:5432/qaroom_content'
const port = Number(process.env.PORT ?? 8081)

runServer(
  async () => {
    const db = drizzle(postgres(connectionString), { schema })
    await ensureSchema(db)
    return buildApp({ db, ...createProductionDeps() })
  },
  { port, name: 'content-service' },
)
