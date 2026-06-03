import { createProductionDeps, runServer } from '@qaroom/service-kit'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { buildIdentity } from './app'
import { runIdentityMigration } from './db/migrate'
import { schema } from './db/schema'
import { ProductionKeyMaterialSource } from './keys'

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://qaroom:qaroom@localhost:5433/qaroom_identity'
const port = Number(process.env.PORT ?? 8082)

runServer(
  async () => {
    const deps = createProductionDeps()
    const db = drizzle(postgres(connectionString), { schema })
    // Provision schema + seed the general community through the migration state machine.
    await runIdentityMigration(db, { clock: deps.clock })
    const built = buildIdentity({
      db,
      ...deps,
      keyMaterial: new ProductionKeyMaterialSource(),
      rotation: { graceMs: 24 * 60 * 60 * 1000 },
    })
    // Mint the first signing key so /jwks.json is non-empty from boot.
    await built.keyStore.ensureCurrent()
    return built.app
  },
  { port, name: 'identity-service' },
)
