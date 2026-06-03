import {
  COMM_GENERAL,
  CommunityId,
  composeMigrations,
  type Migration,
  runMigration,
} from '@qaroom/contracts'
import type { Clock } from '@qaroom/determinism'
import { idempotencyResponsesMigration } from '@qaroom/messaging/migrations'
import { eq, sql } from 'drizzle-orm'
import type { IdentityDb, SqlExecutor } from './client'
import { communities } from './schema'

/** Fixed seed timestamp for the well-known general community (deterministic, not wall-clock). */
const GENERAL_CREATED_AT = '2026-01-01T00:00:00.000Z'

/**
 * The ordered identity-service migration set. Each step is reversible (up + down); the
 * idempotency test (migrations/0001-init.test.ts) proves up→down→up→up converges and
 * that a missing `down` fails. `ensureSchema` applies the composed ups (idempotent DDL);
 * `runIdentityMigration` drives the same ups through the migration state machine + a
 * verify step (the general community seed parses). DDL strings mirror schema.ts.
 */
export const IDENTITY_MIGRATIONS: readonly Migration<SqlExecutor>[] = [
  {
    name: 'create_users',
    async up(tx) {
      await tx.execute(
        sql.raw(`CREATE TABLE IF NOT EXISTS users (
          id text PRIMARY KEY,
          handle text NOT NULL UNIQUE,
          display_name text NOT NULL,
          created_at timestamptz NOT NULL
        )`),
      )
    },
    async down(tx) {
      await tx.execute(sql.raw('DROP TABLE IF EXISTS users'))
    },
  },
  {
    name: 'create_communities',
    async up(tx) {
      await tx.execute(
        sql.raw(`CREATE TABLE IF NOT EXISTS communities (
          id text PRIMARY KEY,
          slug text NOT NULL UNIQUE,
          name text NOT NULL,
          created_at timestamptz NOT NULL
        )`),
      )
      // Seed the well-known general community (ADR-0007). Idempotent via ON CONFLICT.
      await tx.execute(sql`
        INSERT INTO communities (id, slug, name, created_at)
        VALUES (${COMM_GENERAL}, 'general', 'General', ${GENERAL_CREATED_AT})
        ON CONFLICT (id) DO NOTHING
      `)
    },
    async down(tx) {
      await tx.execute(sql.raw('DROP TABLE IF EXISTS communities'))
    },
  },
  {
    name: 'create_memberships',
    async up(tx) {
      await tx.execute(
        sql.raw(`CREATE TABLE IF NOT EXISTS memberships (
          user_id text NOT NULL,
          community_id text NOT NULL,
          role text NOT NULL,
          joined_at timestamptz NOT NULL,
          PRIMARY KEY (user_id, community_id)
        )`),
      )
      await tx.execute(
        sql.raw(
          'CREATE INDEX IF NOT EXISTS memberships_community_idx ON memberships (community_id)',
        ),
      )
    },
    async down(tx) {
      await tx.execute(sql.raw('DROP TABLE IF EXISTS memberships'))
    },
  },
  {
    name: 'create_sessions',
    async up(tx) {
      await tx.execute(
        sql.raw(`CREATE TABLE IF NOT EXISTS sessions (
          id text PRIMARY KEY,
          user_id text NOT NULL,
          kid text NOT NULL,
          issued_at timestamptz NOT NULL,
          expires_at timestamptz NOT NULL
        )`),
      )
    },
    async down(tx) {
      await tx.execute(sql.raw('DROP TABLE IF EXISTS sessions'))
    },
  },
  {
    name: 'create_signing_keys',
    async up(tx) {
      await tx.execute(
        sql.raw(`CREATE TABLE IF NOT EXISTS signing_keys (
          kid text PRIMARY KEY,
          alg text NOT NULL,
          public_jwk jsonb NOT NULL,
          private_jwk jsonb NOT NULL,
          status text NOT NULL,
          created_at timestamptz NOT NULL,
          retired_at timestamptz
        )`),
      )
      // At most one 'current' key at a time (rotation invariant, ADR-0008).
      await tx.execute(
        sql.raw(
          `CREATE UNIQUE INDEX IF NOT EXISTS signing_keys_one_current ON signing_keys (status) WHERE status = 'current'`,
        ),
      )
    },
    async down(tx) {
      await tx.execute(sql.raw('DROP TABLE IF EXISTS signing_keys'))
    },
  },
  // The Idempotency-Key replay store is the shared @qaroom/messaging fragment (one shape
  // across services), not a per-service copy of the DDL.
  idempotencyResponsesMigration,
]

const composed = composeMigrations(IDENTITY_MIGRATIONS)

/** Apply the identity schema (idempotent). Used by the test harness and as the migration's up step. */
export async function ensureSchema(db: SqlExecutor): Promise<void> {
  await composed.up(db)
}

/** True when the seeded general community exists and its id parses as a branded CommunityId. */
async function generalCommunitySeeded(db: IdentityDb): Promise<boolean> {
  const rows = await db
    .select({ id: communities.id })
    .from(communities)
    .where(eq(communities.id, COMM_GENERAL))
    .limit(1)
  return rows.length === 1 && CommunityId.safeParse(rows[0]?.id).success
}

/**
 * Provision the schema through the migration state machine (Milestone 2 "first taste"):
 * Pending → Backfilling (apply DDL + seed) → Verifying (general community parses) → Done.
 * Used on boot and in provider verification.
 */
export async function runIdentityMigration(db: IdentityDb, deps: { clock: Clock }): Promise<void> {
  await runMigration<IdentityDb>(
    {
      tx: db,
      backfill: (tx) => composed.up(tx),
      verify: (tx) => generalCommunitySeeded(tx),
    },
    { clock: deps.clock },
  )
}
