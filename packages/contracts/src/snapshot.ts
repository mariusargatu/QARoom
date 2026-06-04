import { z } from 'zod'

/**
 * Scoped scenario replay (Commitment 8, Milestone 7). A snapshot captures, per service, its
 * database state + the in-memory Lamport counter + the clock instant — enough to reproduce a
 * scenario's observable behaviour (`as_of.lamport`, response bodies, errors) in a fresh
 * environment, with the documented limits: no in-flight HTTP, no JetStream stream restore, no
 * WebSocket session state.
 *
 * Versioned and append-only: `SnapshotBundleV2` ships alongside this, never replaces it. Restore
 * refuses a bundle whose `schema_version` it does not understand.
 */
export const SNAPSHOT_SCHEMA_VERSION = 1

/** A row is an opaque JSON object — the app-level dump keeps column names as-is for diffability. */
const SnapshotRow = z.record(z.string(), z.unknown())

/** One service's capture: every domain table as JSON rows, plus the lamport + clock seed. */
export const ServiceSnapshot = z
  .object({
    schema_version: z.literal(SNAPSHOT_SCHEMA_VERSION),
    service: z.string(),
    captured_at: z.iso.datetime(),
    /** Lamport counter at capture; restore sets it back so `as_of.lamport` reproduces exactly. */
    lamport: z.number().int().nonnegative(),
    /** Clock instant at capture; replay boots a `FixedClock` here for deterministic time. */
    clock_seed: z.iso.datetime(),
    /** `tableName -> rows`. Restore truncates every listed table then re-inserts these rows. */
    tables: z.record(z.string(), z.array(SnapshotRow)),
  })
  .meta({
    id: 'ServiceSnapshot',
    description: 'One service’s DB + lamport + clock-seed capture for scenario replay.',
  })
export type ServiceSnapshot = z.infer<typeof ServiceSnapshot>

/** A service's entry in the bundle manifest (summary; the rows live in `snapshot_file`). */
export const SnapshotManifestEntry = z
  .object({
    name: z.string(),
    snapshot_file: z.string(),
    lamport: z.number().int().nonnegative(),
    clock_seed: z.iso.datetime(),
  })
  .meta({ id: 'SnapshotManifestEntry', description: 'A service entry in the snapshot bundle.' })
export type SnapshotManifestEntry = z.infer<typeof SnapshotManifestEntry>

/**
 * The bundle manifest (`manifest.json` in the tarball). Describes the per-service snapshot files
 * and any chaos manifests captured verbatim (so a chaos run is replayable from the bundle alone,
 * Commitment 6). This is the V1 bundle contract.
 */
export const SnapshotBundleV1 = z
  .object({
    schema_version: z.literal(SNAPSHOT_SCHEMA_VERSION),
    created_at: z.iso.datetime(),
    services: z.array(SnapshotManifestEntry),
    /** Relative paths, inside the bundle, of chaos manifests captured verbatim. */
    chaos_manifests: z.array(z.string()),
  })
  .meta({
    id: 'SnapshotBundleV1',
    description: 'Versioned scenario-replay bundle manifest (Milestone 7).',
  })
export type SnapshotBundleV1 = z.infer<typeof SnapshotBundleV1>

/** Raw table rows keyed by table name — the app-level dump shape, single-sourced for every package. */
export type SnapshotTables = Record<string, Array<Record<string, unknown>>>

/**
 * The per-service capture/restore seam. service-kit owns the HTTP route + envelope; the postgres
 * implementation (`pgSnapshotStore`) lives in @qaroom/messaging. Both satisfy this one contract.
 */
export interface SnapshotStore {
  capture(): Promise<SnapshotTables>
  restore(tables: SnapshotTables): Promise<void>
}
