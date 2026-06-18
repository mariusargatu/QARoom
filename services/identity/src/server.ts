import { connectServiceDb } from '@qaroom/messaging'
import { intFromEnv, pgPoolMax, resolveBootDeps, runServer } from '@qaroom/service-kit'
import { buildIdentity } from './app'
import { runIdentityMigration } from './db/migrate'
import { schema } from './db/schema'
import { ProductionKeyMaterialSource } from './keys'

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://qaroom:qaroom@localhost:5433/qaroom_identity'
const port = intFromEnv('PORT', 8082)

runServer(
  async () => {
    // Snapshot-replay (Commitment 8) only pins the clock here; identity always migrates and mints
    // its own key. `signing_keys` is excluded (private JWK material — security), and `sessions`
    // with it: a session's `kid` points at that un-exported key, so a captured token could never
    // verify against the fresh key a replay env mints — replay clients re-authenticate instead.
    const { deps } = resolveBootDeps()
    const { db, snapshotStore } = connectServiceDb({
      connectionString,
      schema,
      max: pgPoolMax(),
      exclude: ['signing_keys', 'sessions'],
    })
    // Provision schema + seed the general community through the migration state machine.
    await runIdentityMigration(db, { clock: deps.clock })
    const built = buildIdentity({
      db,
      ...deps,
      keyMaterial: new ProductionKeyMaterialSource(),
      rotation: { graceMs: 24 * 60 * 60 * 1000 },
      snapshotStore,
    })
    // Mint the first signing key on every boot (including replay — keys are not snapshotted).
    await built.keyStore.ensureCurrent()
    return built.app
  },
  { port, name: 'identity-service' },
)
