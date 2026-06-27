import { test } from '@fast-check/vitest'
import { ACCESS_TOKEN_ISSUER, AccessTokenClaims } from '@qaroom/contracts'
import { communityIdArb, userIdArb } from '@qaroom/testing-utils/generators'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { constantContent, setupGatewayTest, tokenVerifierStub } from './harness'

/**
 * Object-level authorization at the gateway edge (OWASP API#1, BOLA/IDOR). The ONLY object-level
 * authz surface in QARoom is community membership, enforced on the events read path (ADR-0025): a
 * bearer token's `memberships` claim must include the requested community or the read is refused
 * (403 `not-a-member`). There is NO intra-tenant per-user object-ownership layer — within a
 * community all members are peers, and write-time identity (`author_id`/`voter_id`/`user_id`) is
 * caller-asserted on the unauthenticated REST plane (ADR-0022). So the strongest BOLA-shaped case
 * that EXISTS is the cross-tenant denial, which this suite pins under property generation: across
 * generated community pairs, a user scoped to one community can never read the other's stream, and
 * the denial is exactly 403 — never a loose "non-2xx".
 */
const okStream = { status: 200, body: {}, contentType: null } as const
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

function memberOf(userId: string, communityId: string): AccessTokenClaims {
  return AccessTokenClaims.parse({
    sub: userId,
    iss: ACCESS_TOKEN_ISSUER,
    iat: 0,
    exp: 9_999_999_999,
    memberships: [{ community_id: communityId, role: 'member' }],
  })
}

/** Two distinct communities — the BOLA matrix needs a resource the requester does NOT own. */
const communityPairArb = fc.tuple(communityIdArb, communityIdArb).filter(([a, b]) => a !== b)

const TOKEN_A = 'tok_a'
const TOKEN_B = 'tok_b'

describe('BOLA/IDOR cross-tenant object authz (events read, ADR-0025)', () => {
  test.prop([communityPairArb, userIdArb, userIdArb], { numRuns: 16 })(
    'a user scoped to one community is denied (exactly 403) reading another community by id; each reads only its own',
    async ([communityA, communityB], userA, userB) => {
      const ctx = setupGatewayTest(constantContent(okStream), {
        verifyToken: tokenVerifierStub({
          [TOKEN_A]: memberOf(userA, communityA),
          [TOKEN_B]: memberOf(userB, communityB),
        }),
      })
      // User A reaches for B's stream by id, and B for A's — the BOLA attempt.
      const aReadsB = await ctx.request.get(
        `/api/communities/${communityB}/events`,
        bearer(TOKEN_A),
      )
      const bReadsA = await ctx.request.get(
        `/api/communities/${communityA}/events`,
        bearer(TOKEN_B),
      )
      // Positive controls: each reads its OWN community.
      const aReadsA = await ctx.request.get(
        `/api/communities/${communityA}/events`,
        bearer(TOKEN_A),
      )
      const bReadsB = await ctx.request.get(
        `/api/communities/${communityB}/events`,
        bearer(TOKEN_B),
      )
      await ctx.app.close()

      // Exactly 403 (severity: not a loose status range), authorization domain, not-a-member type.
      expect(aReadsB.status).toBe(403)
      expect((aReadsB.json as { failure_domain?: string }).failure_domain).toBe('authorization')
      expect((aReadsB.json as { type?: string }).type).toContain('not-a-member')
      expect(bReadsA.status).toBe(403)
      expect((bReadsA.json as { failure_domain?: string }).failure_domain).toBe('authorization')
      expect(aReadsA.status).toBe(200)
      expect(bReadsB.status).toBe(200)
    },
  )

  test.prop([communityIdArb, userIdArb], { numRuns: 16 })(
    'an unauthenticated cross-tenant read by id is rejected (exactly 401) before any membership check',
    async (community, userId) => {
      const ctx = setupGatewayTest(constantContent(okStream), {
        verifyToken: tokenVerifierStub({ [TOKEN_A]: memberOf(userId, community) }),
      })
      const noToken = await ctx.request.get(`/api/communities/${community}/events`)
      const badToken = await ctx.request.get(
        `/api/communities/${community}/events`,
        bearer('tok_forged'),
      )
      await ctx.app.close()

      expect(noToken.status).toBe(401)
      expect((noToken.json as { failure_domain?: string }).failure_domain).toBe('authentication')
      expect(badToken.status).toBe(401)
    },
  )
})

// Documents the honest BOLA FINDING as an explicit, falsifiable test rather than only prose: within
// a single community there is no per-user object-ownership gate. Two DIFFERENT users, both members
// of the same community, both read its stream (200/200). If a future per-user authz layer is added,
// this control must be revisited — it pins the current architecture (ADR-0022/ADR-0025), not a wish.
describe('intra-tenant: members of one community are peers (no per-user object authz)', () => {
  it('lets two distinct member tokens of the same community both read it (200/200)', async () => {
    const community = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CE'
    const ctx = setupGatewayTest(constantContent(okStream), {
      verifyToken: tokenVerifierStub({
        [TOKEN_A]: memberOf('user_01HZY0K7M3QF8VN2J5RX9TB4CF', community),
        [TOKEN_B]: memberOf('user_01HZY0K7M3QF8VN2J5RX9TB4CG', community),
      }),
    })
    const a = await ctx.request.get(`/api/communities/${community}/events`, bearer(TOKEN_A))
    const b = await ctx.request.get(`/api/communities/${community}/events`, bearer(TOKEN_B))
    await ctx.app.close()

    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
  })
})
