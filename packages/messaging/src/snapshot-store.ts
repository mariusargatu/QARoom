import type { SnapshotStore, SnapshotTables } from '@qaroom/contracts'
import type { Sql } from 'postgres'

/**
 * The @qaroom/messaging plumbing tables. They hold transient broker-replay state (outbox / dedup /
 * idempotency), never part of a captured scenario, so they are excluded from the DUMP. But unlike
 * the caller's `exclude` set they ARE reset (truncated, not re-inserted) on restore, so a reused
 * replay env can't serve a stale idempotent response or re-deliver a stale outbox row — a restore
 * resets the env to exactly the captured domain state. They belong to messaging, so messaging owns
 * this list; a service's own non-portable tables go through `exclude`.
 */
const PLUMBING_TABLES = ['outbox', 'processed_events', 'idempotency_responses'] as const

/**
 * App-level snapshot store (Commitment 8): dump every `public` domain base table to JSON and
 * reload it. Generic over the schema, shared by every DB service. Uses the raw postgres-js client
 * for safe identifier escaping (`sql(name)`) and bulk insert (`sql(rows)`).
 *
 * `exclude` names tables that are NEVER touched — not dumped, not truncated, not inserted (e.g.
 * identity's `signing_keys`: private JWK material the replay env mints for itself, and `sessions`,
 * whose `kid` references the un-exported key so captured tokens couldn't verify anyway).
 */
export function pgSnapshotStore(
  sql: Sql,
  opts: { exclude?: readonly string[] } = {},
): SnapshotStore {
  const neverTouch = new Set<string>(opts.exclude ?? [])
  const notDumped = new Set<string>([...PLUMBING_TABLES, ...neverTouch])

  async function allBaseTables(): Promise<string[]> {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`
    return rows.map((r) => r.table_name)
  }

  return {
    async capture(): Promise<SnapshotTables> {
      const names = (await allBaseTables()).filter((name) => !notDumped.has(name))
      // One REPEATABLE READ READ ONLY snapshot so a concurrent write can't tear the multi-table
      // dump (a vote captured without its post). Every dumped table is present (empty -> []),
      // which restore relies on to detect schema skew.
      const tables = await sql.begin('isolation level repeatable read read only', async (tx) => {
        const dumps = await Promise.all(
          names.map(async (name) => [name, await tx`SELECT * FROM ${tx(name)}`] as const),
        )
        return Object.fromEntries(dumps)
      })
      return tables as SnapshotTables
    },

    async restore(tables: SnapshotTables): Promise<void> {
      const base = await allBaseTables()
      // Schema-skew guard: a faithful capture dumps EVERY non-excluded base table (empty -> []), so
      // the payload's table set must equal this env's. A mismatch means the capture and replay
      // schemas differ — refuse loudly rather than silently truncate a table the payload omits.
      const expected = base.filter((name) => !notDumped.has(name))
      const got = Object.keys(tables)
      const missing = expected.filter((name) => !got.includes(name))
      const extra = got.filter((name) => !expected.includes(name))
      if (missing.length > 0 || extra.length > 0) {
        throw new Error(
          `snapshot schema mismatch: payload tables [${[...got].sort().join(', ')}] do not match ` +
            `this service's base tables [${[...expected].sort().join(', ')}] — capture and replay ` +
            `schemas must be identical`,
        )
      }
      await sql.begin(async (tx) => {
        await tx`SET LOCAL session_replication_role = 'replica'`
        // Reset every base table except the never-touch set (so plumbing IS reset), then re-insert
        // the captured domain rows.
        for (const name of base.filter((n) => !neverTouch.has(n))) {
          await tx`TRUNCATE ${tx(name)} CASCADE`
        }
        for (const [name, rows] of Object.entries(tables)) {
          if (rows.length === 0) continue
          // Chunk the bulk insert under Postgres's 65534 bind-parameter cap per statement.
          // postgres-js flattens a multi-row insert into cols×rows parameters, so a wide table
          // with many rows (a busy content-service snapshot) blows the limit in ONE statement.
          // Found via seam A's replay of a gauntlet-sized bundle, 2026-06-10.
          const cols = Object.keys(rows[0] ?? {}).length || 1
          const perChunk = Math.max(1, Math.floor(65534 / cols))
          for (let i = 0; i < rows.length; i += perChunk) {
            await tx`INSERT INTO ${tx(name)} ${tx(rows.slice(i, i + perChunk))}`
          }
        }
      })
    },
  }
}
