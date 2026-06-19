import { LamportGate } from '@qaroom/contracts'
import { type RepoTest, setupRepoTest } from '@qaroom/testing-utils/harness'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { IdentityDb } from './db/client'
import { ensureSchema } from './db/migrate'
import type { RepoDeps } from './deps'
import {
  addMembership,
  type CommunityRecord,
  countRows,
  createCommunity,
  createUser,
  getUser,
  listMembers,
  membershipsForUser,
  recordSession,
} from './repository'

/**
 * identity-service repository: the slug/membership uniqueness branches and the conditional
 * lamport bumps had no unit test. `ensureSchema` seeds exactly one well-known general community
 * (ADR-0007), so `communities` starts at 1 — the conflict tests lean on that seeded slug.
 */
const ABSENT_COMMUNITY = 'comm_01HZY0K7M3QF8VN2J5RX9TB4ZZ'

let ctx: RepoTest<IdentityDb>
let deps: RepoDeps

const mkUser = (handle: string) => createUser(ctx.db, deps, { handle, displayName: handle })

const requireComm = async (slug: string): Promise<CommunityRecord> => {
  const c = await createCommunity(ctx.db, deps, { slug, name: slug })
  expect(c).not.toBeNull()
  return c as CommunityRecord
}

beforeEach(async () => {
  ctx = await setupRepoTest<IdentityDb>({ applyMigrations: (db) => ensureSchema(db) })
  deps = { clock: ctx.clock, ids: ctx.ids, lamport: new LamportGate(ctx.ids) }
})

afterEach(async () => {
  await ctx.close()
})

describe('repository/createUser + getUser', () => {
  it('creates a user, bumps the lamport gate, and reads it back by id', async () => {
    const user = await mkUser('ada')

    expect(user).toMatchObject({ handle: 'ada', display_name: 'ada' })
    expect(user.id.startsWith('user_')).toBe(true)
    expect(deps.lamport.value).toBe(1)
    expect(await getUser(ctx.db, user.id)).toEqual(user)
  })

  it('returns null for an unknown user id', async () => {
    expect(await getUser(ctx.db, 'user_01HZY0K7M3QF8VN2J5RX9TB4ZZ')).toBeNull()
  })
})

describe('repository/createCommunity', () => {
  it('creates a community with a fresh slug and bumps the lamport gate', async () => {
    const before = deps.lamport.value
    const comm = await requireComm('cats')

    expect(comm).toMatchObject({ slug: 'cats', name: 'cats' })
    expect(deps.lamport.value).toBe(before + 1)
  })

  it('returns null on a slug already taken and does not bump the gate', async () => {
    await requireComm('cats')
    const at = deps.lamport.value

    expect(await createCommunity(ctx.db, deps, { slug: 'cats', name: 'Cats Again' })).toBeNull()
    expect(deps.lamport.value).toBe(at)
  })

  it('returns null against the seeded general community slug', async () => {
    expect(await createCommunity(ctx.db, deps, { slug: 'general', name: 'X' })).toBeNull()
  })
})

describe('repository/addMembership', () => {
  it('reports community-not-found when the community does not exist', async () => {
    const user = await mkUser('ada')

    expect(await addMembership(ctx.db, deps, ABSENT_COMMUNITY, user.id, 'member')).toEqual({
      error: 'community-not-found',
    })
  })

  it('adds a membership, bumps the gate, then rejects a duplicate for the same (community,user)', async () => {
    const comm = await requireComm('cats')
    const user = await mkUser('ada')
    const at = deps.lamport.value

    const added = await addMembership(ctx.db, deps, comm.id, user.id, 'member')
    expect(added).toMatchObject({
      membership: { user_id: user.id, community_id: comm.id, role: 'member' },
    })
    expect(deps.lamport.value).toBe(at + 1)

    const dup = await addMembership(ctx.db, deps, comm.id, user.id, 'moderator')
    expect(dup).toEqual({ error: 'membership-exists' })
    expect(deps.lamport.value).toBe(at + 1) // no bump on the rejected duplicate
  })
})

describe('repository/listMembers + membershipsForUser', () => {
  it('returns null for a community that does not exist', async () => {
    expect(await listMembers(ctx.db, ABSENT_COMMUNITY)).toBeNull()
  })

  it('lists a community’s members newest-join-first, scoped to that community', async () => {
    const comm = await requireComm('cats')
    const dogs = await requireComm('dogs')
    const ada = await mkUser('ada')
    const bob = await mkUser('bob')
    const eve = await mkUser('eve')
    await addMembership(ctx.db, deps, comm.id, ada.id, 'member')
    ctx.clock.advance(1000)
    await addMembership(ctx.db, deps, comm.id, bob.id, 'member')
    await addMembership(ctx.db, deps, dogs.id, eve.id, 'member') // a member of ANOTHER community

    const members = await listMembers(ctx.db, comm.id)
    // Newest-join-first AND community-scoped — eve (in dogs) must not appear, which kills the
    // `eq(memberships.communityId, communityId)` mutant the single-community version left alive.
    expect(members?.map((m) => m.user_id)).toEqual([bob.id, ada.id])
  })

  it('returns every membership a user holds across communities, scoped to that user', async () => {
    const a = await requireComm('cats')
    const b = await requireComm('dogs')
    const ada = await mkUser('ada')
    const bob = await mkUser('bob')
    await addMembership(ctx.db, deps, a.id, ada.id, 'member')
    await addMembership(ctx.db, deps, b.id, ada.id, 'moderator')
    await addMembership(ctx.db, deps, a.id, bob.id, 'member') // bob shares community a — must not leak

    const held = await membershipsForUser(ctx.db, ada.id)
    expect(held.map((m) => m.community_id).sort()).toEqual([a.id, b.id].sort())
    // The whole point: this feeds the JWT memberships claim, so the userId filter must be load-bearing.
    expect(held.every((m) => m.user_id === ada.id)).toBe(true)
  })
})

describe('repository/recordSession + countRows', () => {
  it('counts the seeded general community and reflects an inserted session', async () => {
    expect(await countRows(ctx.db)).toEqual({
      users: 0,
      communities: 1,
      memberships: 0,
      sessions: 0,
      keys: 0,
    })

    const user = await mkUser('ada')
    await recordSession(ctx.db, {
      id: 'sess_01HZY0K7M3QF8VN2J5RX9TB4CG',
      userId: user.id,
      kid: 'key_01HZY0K7M3QF8VN2J5RX9TB4CH',
      issuedAt: ctx.clock.now(),
      expiresAt: new Date(ctx.clock.now().getTime() + 3_600_000),
    })

    const counts = await countRows(ctx.db)
    expect(counts.users).toBe(1)
    expect(counts.sessions).toBe(1)
    expect(counts.communities).toBe(1)
  })
})
