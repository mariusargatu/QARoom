import { advisoryLock } from '@qaroom/messaging'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { IdentityDb } from './db/client'
import { communities, memberships, sessions, signingKeys, users } from './db/schema'
import type { RepoDeps } from './deps'
import { publishUserErased } from './events/user-erased'

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

export type AddMembershipResult =
  | { membership: MembershipRecord }
  | { error: 'community-not-found' }
  | { error: 'membership-exists' }

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

export interface EraseUserResult {
  /** The erasure saga's handle (`erasure_<ulid>`), returned in the 202 and used for tracking. */
  sagaId: string
  /** The communities a `user.erased` event was staged for — the per-tenant cascade fan-out. */
  communities: string[]
}

/**
 * Erase a user (GDPR right-to-erasure, ADR-0036). Identity-OWNED step of the cross-service saga:
 * in ONE transaction it advisory-locks the user (single-writer), deletes the user's identity-local
 * rows (sessions, memberships, the user), and stages one `user.erased` event on the outbox per
 * community the user belonged to — captured BEFORE the memberships are deleted. The relay drains
 * those events; content- and donations-service consume them and delete their slice. Returns null
 * when no such user exists (route → 404), so a missing user is never a silent no-op success.
 *
 * NAMED limitation (ADR-0036): the fan-out is driven by MEMBERSHIP. Data a user left behind in a
 * community whose membership was already removed is not reached by this cascade and needs a separate
 * sweep — a conscious v1 boundary, not an oversight.
 */
export async function eraseUser(
  db: IdentityDb,
  deps: RepoDeps,
  userId: string,
): Promise<EraseUserResult | null> {
  const requestedAt = deps.clock.now()
  const sagaId = deps.ids.next('erasure')
  const result = await db.transaction(async (tx): Promise<EraseUserResult | null> => {
    await advisoryLock(tx, userId)
    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (existing.length === 0) return null
    const userMemberships = await tx
      .select({ communityId: memberships.communityId })
      .from(memberships)
      .where(eq(memberships.userId, userId))
    const communityIds = userMemberships.map((m) => m.communityId)
    await tx.delete(sessions).where(eq(sessions.userId, userId))
    await tx.delete(memberships).where(eq(memberships.userId, userId))
    await tx.delete(users).where(eq(users.id, userId))
    for (const communityId of communityIds) {
      await publishUserErased(tx, deps.ids, { userId, communityId, requestedAt })
    }
    return { sagaId, communities: communityIds }
  })
  if (result) deps.lamport.bump()
  return result
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
