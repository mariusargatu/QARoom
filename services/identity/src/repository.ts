import { and, desc, eq, sql } from 'drizzle-orm'
import type { IdentityDb, SqlExecutor } from './db/client'
import {
  communities,
  idempotencyResponses,
  memberships,
  sessions,
  signingKeys,
  users,
} from './db/schema'
import type { RepoDeps } from './deps'

/** snake_case records matching the contracts; route handlers parse/brand them. */
export interface UserRecord {
  id: string
  handle: string
  display_name: string
  created_at: string
}
export interface CommunityRecord {
  id: string
  slug: string
  name: string
  created_at: string
}
export interface MembershipRecord {
  user_id: string
  community_id: string
  role: string
  joined_at: string
}

export interface StoredResponse {
  status: number
  body: unknown
}

export type AddMembershipResult =
  | { membership: MembershipRecord }
  | { error: 'community-not-found' }
  | { error: 'membership-exists' }

/** Single-writer-per-resource (Commitment 4): serialize writers on a transaction-scoped advisory lock. */
async function advisoryLock(ex: SqlExecutor, resourceId: string): Promise<void> {
  await ex.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${resourceId}, 0))`)
}

function rowToUser(r: typeof users.$inferSelect): UserRecord {
  return {
    id: r.id,
    handle: r.handle,
    display_name: r.displayName,
    created_at: r.createdAt.toISOString(),
  }
}
function rowToCommunity(r: typeof communities.$inferSelect): CommunityRecord {
  return { id: r.id, slug: r.slug, name: r.name, created_at: r.createdAt.toISOString() }
}
function rowToMembership(r: typeof memberships.$inferSelect): MembershipRecord {
  return {
    user_id: r.userId,
    community_id: r.communityId,
    role: r.role,
    joined_at: r.joinedAt.toISOString(),
  }
}

export async function createUser(
  db: IdentityDb,
  deps: RepoDeps,
  input: { handle: string; displayName: string },
): Promise<UserRecord> {
  const row = {
    id: deps.ids.next('user'),
    handle: input.handle,
    displayName: input.displayName,
    createdAt: deps.clock.now(),
  }
  await db.transaction(async (tx) => {
    await advisoryLock(tx, row.id)
    await tx.insert(users).values(row)
  })
  deps.lamport.bump()
  return rowToUser(row)
}

export async function getUser(db: IdentityDb, userId: string): Promise<UserRecord | null> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  const r = rows[0]
  return r ? rowToUser(r) : null
}

/** Create a community. Returns null when the slug is already taken (route → 409 conflict). */
export async function createCommunity(
  db: IdentityDb,
  deps: RepoDeps,
  input: { slug: string; name: string },
): Promise<CommunityRecord | null> {
  const row = {
    id: deps.ids.next('comm'),
    slug: input.slug,
    name: input.name,
    createdAt: deps.clock.now(),
  }
  const result = await db.transaction(async (tx) => {
    await advisoryLock(tx, `community:slug:${input.slug}`)
    const existing = await tx
      .select({ id: communities.id })
      .from(communities)
      .where(eq(communities.slug, input.slug))
      .limit(1)
    if (existing.length > 0) return null
    await tx.insert(communities).values(row)
    return rowToCommunity(row)
  })
  if (result) deps.lamport.bump()
  return result
}

export async function addMembership(
  db: IdentityDb,
  deps: RepoDeps,
  communityId: string,
  userId: string,
  role: string,
): Promise<AddMembershipResult> {
  const row = { userId, communityId, role, joinedAt: deps.clock.now() }
  const result = await db.transaction(async (tx): Promise<AddMembershipResult> => {
    await advisoryLock(tx, `membership:${communityId}:${userId}`)
    const community = await tx
      .select({ id: communities.id })
      .from(communities)
      .where(eq(communities.id, communityId))
      .limit(1)
    if (community.length === 0) return { error: 'community-not-found' }
    const existing = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.communityId, communityId)))
      .limit(1)
    if (existing.length > 0) return { error: 'membership-exists' }
    await tx.insert(memberships).values(row)
    return { membership: rowToMembership(row) }
  })
  if ('membership' in result) deps.lamport.bump()
  return result
}

/** List a community's members. Returns null when the community does not exist (route → 404 tenant_resolution). */
export async function listMembers(
  db: IdentityDb,
  communityId: string,
): Promise<MembershipRecord[] | null> {
  const community = await db
    .select({ id: communities.id })
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1)
  if (community.length === 0) return null
  const rows = await db
    .select()
    .from(memberships)
    .where(eq(memberships.communityId, communityId))
    .orderBy(desc(memberships.joinedAt))
  return rows.map(rowToMembership)
}

/** Every membership a user holds — the source of the JWT `memberships` claim. */
export async function membershipsForUser(
  db: IdentityDb,
  userId: string,
): Promise<MembershipRecord[]> {
  const rows = await db.select().from(memberships).where(eq(memberships.userId, userId))
  return rows.map(rowToMembership)
}

export async function recordSession(
  db: IdentityDb,
  record: { id: string; userId: string; kid: string; issuedAt: Date; expiresAt: Date },
): Promise<void> {
  await db.insert(sessions).values(record)
}

export async function findIdempotent(
  db: IdentityDb,
  key: string,
  route: string,
  hash: string,
): Promise<StoredResponse | null> {
  const rows = await db
    .select()
    .from(idempotencyResponses)
    .where(
      and(
        eq(idempotencyResponses.idempotencyKey, key),
        eq(idempotencyResponses.route, route),
        eq(idempotencyResponses.bodyHash, hash),
      ),
    )
    .limit(1)
  const r = rows[0]
  return r ? { status: r.status, body: r.responseBody } : null
}

export async function storeIdempotent(
  db: IdentityDb,
  deps: RepoDeps,
  record: { key: string; route: string; hash: string; status: number; body: unknown },
): Promise<void> {
  await db
    .insert(idempotencyResponses)
    .values({
      idempotencyKey: record.key,
      route: record.route,
      bodyHash: record.hash,
      status: record.status,
      responseBody: record.body,
      createdAt: deps.clock.now(),
    })
    .onConflictDoNothing()
}

export async function countRows(db: IdentityDb): Promise<{
  users: number
  communities: number
  memberships: number
  sessions: number
  keys: number
}> {
  const u = await db.select({ n: sql<number>`count(*)::int` }).from(users)
  const c = await db.select({ n: sql<number>`count(*)::int` }).from(communities)
  const m = await db.select({ n: sql<number>`count(*)::int` }).from(memberships)
  const s = await db.select({ n: sql<number>`count(*)::int` }).from(sessions)
  const k = await db.select({ n: sql<number>`count(*)::int` }).from(signingKeys)
  return {
    users: u[0]?.n ?? 0,
    communities: c[0]?.n ?? 0,
    memberships: m[0]?.n ?? 0,
    sessions: s[0]?.n ?? 0,
    keys: k[0]?.n ?? 0,
  }
}
