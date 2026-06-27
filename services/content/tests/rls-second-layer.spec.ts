import { pgliteRows, setupRepoTest, withResource } from '@qaroom/testing-utils/harness'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { resolveFaults } from '../src/config/faults'
import type { ContentDb } from '../src/db/client'
import { ensureSchema } from '../src/db/migrate'
import { withCommunityScope } from '../src/db/rls'

/**
 * RLS as the SECOND tenancy layer (ADR-0035), proven IN-PROCESS (Tier-A).
 *
 * The existing `tenant-isolation` property proves the SERVICE-layer `WHERE` guard works. It cannot
 * prove a second layer exists, because until this card there wasn't one. This test proves it: it
 * removes the service-layer filter entirely (`SELECT … WHERE true`, the worst broken-service case) and
 * asserts the DATABASE still hides another tenant's rows — the Row-Level Security policy catches a
 * broken service layer.
 *
 * The mechanism (validated against PGlite, PostgreSQL 16.4 WASM): RLS, even under FORCE, is bypassed
 * by the superuser/owner and only bites for a NON-superuser role — exactly how a deployed service
 * connects. So the test creates a non-superuser app role, `SET ROLE`s to it, binds the request's
 * community through `withCommunityScope` (the same transaction-local GUC the production `listFeed`
 * uses), and runs the broken read. The community context, not the missing service filter, is what
 * scopes the result.
 *
 * Falsifier (the `rls-blocks-broken-service-layer` claim): `pnpm prove rls-blocks-broken-service-layer
 * --break` arms `CONTENT_BUG_DISABLE_RLS=1`, so `ensureSchema` skips the policies — the broken read
 * leaks the other tenant again and the assertions below go RED. Read here in test code to decide the
 * schema setup; the toggle's non-test read site is `config/faults.ts` (`disableRls`).
 */

const COMM_A = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD'
const COMM_B = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CE'
const USER_A = 'user_01HZY0K7M3QF8VN2J5RX9TAAA'
const USER_B = 'user_01HZY0K7M3QF8VN2J5RX9TBBB'

// RLS is on UNLESS the deliberate-bug toggle is armed (then ensureSchema drops the policies).
const rlsEnabled = !resolveFaults().disableRls

async function setupRlsScenario() {
  const ctx = await setupRepoTest<ContentDb>({
    applyMigrations: (db) => ensureSchema(db, { rls: rlsEnabled }),
  })
  // Seed two tenants AS THE SUPERUSER (the owner bypasses RLS — which is exactly why the read under
  // test must run as a non-superuser role). Then become that non-superuser app role for the read: a
  // deployed content-service connects this way, and it is the only role RLS actually filters for.
  await ctx.pglite.exec(`
    INSERT INTO posts (id, community_id, author_id, title, body, score, created_at) VALUES
      ('post_a', '${COMM_A}', '${USER_A}', 'A', 'a-body', 0, now()),
      ('post_b', '${COMM_B}', '${USER_B}', 'B', 'b-body', 0, now());
    INSERT INTO votes (post_id, voter_id, value, created_at) VALUES
      ('post_a', '${USER_A}', 1, now()),
      ('post_b', '${USER_B}', 1, now());
    CREATE ROLE qaroom_app NOLOGIN;
    GRANT SELECT, INSERT, UPDATE, DELETE ON posts TO qaroom_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON votes TO qaroom_app;
    SET ROLE qaroom_app;
  `)
  return ctx
}

describe('RLS: the second tenancy layer (ADR-0035)', () => {
  it('RLS blocks a broken service layer: a cross-tenant posts read under a bound community returns zero foreign rows', () =>
    withResource(setupRlsScenario, async (ctx) => {
      // The broken service layer: the per-community WHERE is GONE (WHERE true). Under the bound
      // community (COMM_A) the database policy must still hide COMM_B's row.
      const communities = await withCommunityScope(ctx.db, COMM_A, async (tx) => {
        const rows = await pgliteRows<{ community_id: string }>(
          tx,
          sql`SELECT community_id FROM posts WHERE true ORDER BY id`,
        )
        return rows.map((r) => r.community_id)
      })
      // RLS on -> only COMM_A survives the unfiltered read. RLS off (toggle) -> COMM_A + COMM_B leak.
      expect(communities).toEqual([COMM_A])
    }))

  it('RLS blocks a broken service layer for votes: the post_id-join policy hides another community votes', () =>
    withResource(setupRlsScenario, async (ctx) => {
      // votes carries no community_id; its policy joins through post_id -> posts.community_id, itself
      // RLS-scoped. A broken (filter-free) votes read under COMM_A must still return only COMM_A votes.
      const postIds = await withCommunityScope(ctx.db, COMM_A, async (tx) => {
        const rows = await pgliteRows<{ post_id: string }>(
          tx,
          sql`SELECT post_id FROM votes WHERE true ORDER BY post_id`,
        )
        return rows.map((r) => r.post_id)
      })
      expect(postIds).toEqual(['post_a'])
    }))

  it('is fail-open when no community is bound, so a query that forgets to bind never returns zero rows', () =>
    withResource(setupRlsScenario, async (ctx) => {
      // No withCommunityScope -> the GUC is unset -> the policy admits every row. This is the
      // defence-in-depth contract: RLS can only ever HIDE a foreign row, never invent a new
      // "returns nothing" failure mode for an unbound query. (Holds with the policies present or
      // absent, so it is not the falsifier — the first two tests are.)
      const communities = pgliteRows<{ community_id: string }>(
        ctx.db,
        sql`SELECT community_id FROM posts ORDER BY id`,
      )
      expect((await communities).map((r) => r.community_id)).toEqual([COMM_A, COMM_B])
    }))
})
