import {
  type LamportGate,
  ServiceSnapshot,
  SNAPSHOT_SCHEMA_VERSION,
  type SnapshotStore,
} from '@qaroom/contracts'
import { type Clock, FixedClock } from '@qaroom/determinism'
import type { FastifyInstance } from 'fastify'
import { createProductionDeps, type ProductionDeps } from './runtime'

export interface SnapshotRoutesOptions {
  service: string
  clock: Clock
  lamport: LamportGate
  /** When absent the routes are not mounted — a service without a store opts out, no guard needed. */
  store?: SnapshotStore
}

/**
 * Register `GET /system/snapshot` (capture) and `POST /system/snapshot` (restore) — a no-op when no
 * `store` is supplied, so callers wire it unconditionally. Capture pairs the DB dump with the
 * in-memory lamport counter and the clock instant; restore reloads the DB, resets the lamport so
 * `as_of.lamport` reproduces, and refuses a bundle whose `schema_version` it does not understand
 * (the `z.literal` in `ServiceSnapshot` rejects it).
 *
 * Security: these endpoints read/replace the whole database — they are a DEV/REPLAY affordance
 * (the system is dev-only, ADR-0009), not for a hardened production deployment.
 */
export function registerSnapshotRoutes(app: FastifyInstance, opts: SnapshotRoutesOptions): void {
  const { store } = opts
  if (!store) return

  app.get('/system/snapshot', async (_req, reply) => {
    const now = opts.clock.now().toISOString()
    const tables = await store.capture()
    reply.code(200).send(
      ServiceSnapshot.parse({
        schema_version: SNAPSHOT_SCHEMA_VERSION,
        service: opts.service,
        captured_at: now,
        lamport: opts.lamport.value,
        clock_seed: now,
        tables,
      }),
    )
  })

  app.post('/system/snapshot', async (req, reply) => {
    const snapshot = ServiceSnapshot.parse(req.body)
    await store.restore(snapshot.tables)
    opts.lamport.restore(snapshot.lamport)
    reply.code(200).send({ restored: true, service: opts.service, lamport: snapshot.lamport })
  })
}

/**
 * Determinism for a snapshot-replay boot: the production trio with the clock pinned to the bundle's
 * `clock_seed`, so `clock.now()` returns the captured instant and time-dependent behaviour
 * reproduces. Ids and randomness stay production primitives for now — read-reproduction (the M7
 * vertical slice) does not generate new ids; seeding them for deterministic write-replay is a
 * fan-out concern.
 */
export function createReplayDeps(clockSeed: string): ProductionDeps {
  return { ...createProductionDeps(), clock: new FixedClock(clockSeed) }
}

const DEFAULT_REPLAY_CLOCK_SEED = '2026-01-01T00:00:00.000Z'

export interface BootDeps {
  deps: ProductionDeps
  /** SNAPSHOT_REPLAY is set: the clock is pinned; callers skip live-only wiring (NATS, relay). */
  replaying: boolean
}

/**
 * Resolve the determinism trio for this boot, owning the snapshot-replay env contract in one place
 * (Commitment 8) so the DB services don't each re-derive it. `SNAPSHOT_REPLAY=1` pins a `FixedClock`
 * to `SNAPSHOT_CLOCK_SEED` (default {@link DEFAULT_REPLAY_CLOCK_SEED}) and flags `replaying`;
 * otherwise the production trio. The strict `=== '1'` check matches the repo's env-toggle
 * convention and avoids the string-truthiness trap where `SNAPSHOT_REPLAY=0`/`=false` would
 * silently enable replay mode (a "live" service that never drains its outbox + a frozen clock).
 */
export function resolveBootDeps(): BootDeps {
  if (process.env.SNAPSHOT_REPLAY !== '1') return { deps: createProductionDeps(), replaying: false }
  const clockSeed = process.env.SNAPSHOT_CLOCK_SEED ?? DEFAULT_REPLAY_CLOCK_SEED
  return { deps: createReplayDeps(clockSeed), replaying: true }
}
