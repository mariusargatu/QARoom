import { sql } from 'drizzle-orm'
import type { ContentDb, SqlExecutor } from './client'

/**
 * Row-Level Security: the SECOND tenancy layer (ADR-0035).
 *
 * The per-community `WHERE` filter in the repository (`listFeed`) is the PRIMARY guard. These Postgres
 * policies are an independent backstop in the database itself, so a broken service-layer filter cannot
 * leak another tenant's rows — the database refuses to return them. RLS is bound to the request's
 * community through a session GUC set transaction-locally (`withCommunityScope`).
 *
 * Two deliberate design points, both documented in ADR-0035:
 *  - FAIL-OPEN when the GUC is unset. `current_setting(..., true)` returns NULL for an unbound GUC, and
 *    the policy then admits every row. This makes RLS pure defence-in-depth: it can only ever HIDE a
 *    cross-tenant row a bound request should not see, never invent a new "returns zero rows" failure
 *    mode for a query that forgot to bind. The service-layer `WHERE` stays the always-on guard.
 *  - PGlite enforces RLS exactly like server Postgres: the superuser/owner BYPASSES it even under
 *    FORCE, so the policies only bite for a non-superuser role. That is how a deployed service (which
 *    connects as a non-superuser application role) gets the backstop, and how the catch-broken-service
 *    test (`tests/rls-second-layer.spec.ts`) proves it in-process under `SET ROLE`.
 */

/** The session GUC the policies key on. One definition; the binding helper and the SQL both use it. */
export const RLS_COMMUNITY_GUC = 'app.current_community_id'

// The fail-open community match, derived once so the posts USING/WITH CHECK clauses cannot drift.
const failOpenCommunityMatch = (column: string): string =>
  `current_setting('${RLS_COMMUNITY_GUC}', true) IS NULL` +
  ` OR current_setting('${RLS_COMMUNITY_GUC}', true) = ''` +
  ` OR ${column} = current_setting('${RLS_COMMUNITY_GUC}', true)`

// votes carries no community_id, so its policy joins through post_id -> posts.community_id. The inner
// posts read is itself RLS-scoped, so the EXISTS only ever sees in-tenant posts (ADR-0035).
const votesPolicyPredicate =
  `current_setting('${RLS_COMMUNITY_GUC}', true) IS NULL` +
  ` OR current_setting('${RLS_COMMUNITY_GUC}', true) = ''` +
  ` OR EXISTS (SELECT 1 FROM posts p WHERE p.id = votes.post_id` +
  ` AND p.community_id = current_setting('${RLS_COMMUNITY_GUC}', true))`

/**
 * The RLS statements, in order. ENABLE + FORCE so the table OWNER is also subject to the policies on a
 * deployed non-superuser connection; DROP POLICY IF EXISTS before CREATE so a re-run (ensureSchema on
 * every boot/test) is idempotent and never errors. Each is a single statement (issued one at a time
 * below) so the same SQL runs under both the porsager-postgres production driver and PGlite in tests.
 */
const RLS_STATEMENTS: readonly string[] = [
  'ALTER TABLE posts ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE posts FORCE ROW LEVEL SECURITY',
  'DROP POLICY IF EXISTS posts_community_isolation ON posts',
  `CREATE POLICY posts_community_isolation ON posts` +
    ` USING (${failOpenCommunityMatch('community_id')})` +
    ` WITH CHECK (${failOpenCommunityMatch('community_id')})`,
  'ALTER TABLE votes ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE votes FORCE ROW LEVEL SECURITY',
  'DROP POLICY IF EXISTS votes_community_isolation ON votes',
  `CREATE POLICY votes_community_isolation ON votes USING (${votesPolicyPredicate})`,
]

/** Apply (or idempotently re-apply) the content RLS policies. Called after the tables exist. */
export async function applyContentRls(db: SqlExecutor): Promise<void> {
  try {
    for (const statement of RLS_STATEMENTS) {
      await db.execute(sql.raw(statement))
    }
  } catch (error) {
    // RLS is schema hardening applied on every boot; a failure here means the tables are missing or
    // the connection lacks DDL rights — surface it with provenance instead of a bare driver error.
    throw new Error(
      `failed to apply content RLS policies (the second tenancy layer, ADR-0035): ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

/**
 * Bind the request's community to the RLS policies for the duration of one transaction, then run `fn`.
 * `set_config(..., is_local => true)` scopes the GUC to this transaction and resets it at COMMIT/ROLLBACK,
 * so a pooled connection never carries one request's tenant into the next. The service-layer `WHERE`
 * stays in place inside `fn`; this only activates the database backstop underneath it.
 */
export async function withCommunityScope<T>(
  db: ContentDb,
  communityId: string,
  fn: (tx: ContentDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config(${RLS_COMMUNITY_GUC}, ${communityId}, true)`)
    return fn(tx as unknown as ContentDb)
  })
}
