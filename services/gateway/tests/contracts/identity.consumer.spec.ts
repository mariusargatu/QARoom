import { resolve } from 'node:path'
import { MatchersV3, PactV4 } from '@pact-foundation/pact'
import {
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_JWK,
  EXAMPLE_KEY_ID,
  EXAMPLE_USER_ID,
} from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { createIdentityClient } from '../../src/clients/identity-client'
import { createJwksClient } from '../../src/clients/jwks-client'

/**
 * Consumer-driven contract (Pact) for the gateway → identity boundary. The gateway declares
 * exactly what it needs from identity-service (the JWKS plus the bootstrap/session surface it now
 * proxies, ADR-0022); running this against the Pact mock emits
 * `services/gateway/pacts/gateway-identity.json`, which identity verifies as provider (see
 * services/identity/tests/contracts/provider.verify.ts). It also exercises the real `jwks-client`
 * and `identity-client` fetch paths.
 *
 * `createWsTicket` is intentionally NOT pacted here: it requires a live ES256-signed bearer that
 * identity verifies against its own keys, which a recorded interaction cannot supply — it is
 * integration-tested at the gateway instead (identity-moderation-proxy.spec.ts), mirroring the
 * un-pacted ticket-redeem path.
 */
const { like, eachLike, regex, integer, string } = MatchersV3

// Hand-authored regexes: the deliberate independent second source (docs/03 §6), NOT derived
// from contracts.
const KID_RE = '^key_[0-9A-HJKMNP-TV-Z]{26}$'
const USER_RE = '^user_[0-9A-HJKMNP-TV-Z]{26}$'
const COMM_RE = '^comm_[0-9A-HJKMNP-TV-Z]{26}$'
const SESS_RE = '^sess_[0-9A-HJKMNP-TV-Z]{26}$'
const HANDLE_RE = '^[a-z0-9_]{2,40}$'
const SLUG_RE = '^[a-z0-9_]{2,64}$'
const ROLE_RE = '^(owner|moderator|member)$'
const ISO_RE = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
const B64URL_RE = '^[A-Za-z0-9_-]+$'

const SECOND_COMMUNITY = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CE'

const userBody = {
  id: regex(USER_RE, EXAMPLE_USER_ID),
  handle: regex(HANDLE_RE, 'ada'),
  display_name: string('Ada Lovelace'),
  created_at: regex(ISO_RE, '2026-01-01T00:00:00.000Z'),
}
const communityBody = {
  id: regex(COMM_RE, EXAMPLE_COMMUNITY_ID),
  slug: regex(SLUG_RE, 'general'),
  name: string('General'),
  created_at: regex(ISO_RE, '2026-01-01T00:00:00.000Z'),
}
const membershipBody = {
  user_id: regex(USER_RE, EXAMPLE_USER_ID),
  community_id: regex(COMM_RE, SECOND_COMMUNITY),
  role: regex(ROLE_RE, 'member'),
  joined_at: regex(ISO_RE, '2026-01-01T00:00:00.000Z'),
}
const asOfBody = {
  snapshot_id: string('snap_fixture'),
  lamport: integer(7),
  wall_clock: regex(ISO_RE, '2026-01-01T00:00:00.000Z'),
}
const sessionBody = {
  session_id: regex(SESS_RE, 'sess_01HZY0K7M3QF8VN2J5RX9TB4CG'),
  access_token: regex('^.+$', 'eyJhbGciOiJFUzI1NiJ9.body.sig'),
  token_type: regex('^Bearer$', 'Bearer'),
  expires_at: regex(ISO_RE, '2026-01-01T00:15:00.000Z'),
  kid: regex(KID_RE, EXAMPLE_KEY_ID),
}

const pact = new PactV4({
  consumer: 'gateway',
  provider: 'identity',
  dir: resolve(import.meta.dirname, '../../pacts'),
  logLevel: 'warn',
})

describe('gateway → identity JWKS consumer contract', () => {
  it('fetches a JWKS containing at least one ES256 verification key', async () => {
    await pact
      .addInteraction()
      .given('a signing key exists', { kid: EXAMPLE_KEY_ID })
      .uponReceiving('a request for the JWKS')
      .withRequest('GET', '/jwks.json')
      .willRespondWith(200, (b) =>
        b.jsonBody(
          like({
            keys: eachLike({
              kty: regex('^EC$', EXAMPLE_JWK.kty),
              crv: regex('^P-256$', EXAMPLE_JWK.crv),
              x: regex(B64URL_RE, EXAMPLE_JWK.x),
              y: regex(B64URL_RE, EXAMPLE_JWK.y),
              kid: regex(KID_RE, EXAMPLE_KEY_ID),
              use: regex('^sig$', 'sig'),
              alg: regex('^ES256$', 'ES256'),
            }),
          }),
        ),
      )
      .executeTest(async (mock) => {
        const res = await createJwksClient(mock.url).getJwks()
        expect(res.status).toBe(200)
        expect((res.body as { keys: unknown[] }).keys.length).toBeGreaterThanOrEqual(1)
      })
  })
})

describe('gateway → identity bootstrap + session consumer contract', () => {
  it('creates a user', async () => {
    await pact
      .addInteraction()
      .uponReceiving('a request to create a user')
      .withRequest('POST', '/api/users', (b) =>
        b
          .headers({ 'content-type': 'application/json', 'Idempotency-Key': like('idem-user-1') })
          .jsonBody({ handle: 'ada', display_name: 'Ada Lovelace' }),
      )
      .willRespondWith(201, (b) => b.jsonBody(like(userBody)))
      .executeTest(async (mock) => {
        const res = await createIdentityClient(mock.url).createUser(
          { handle: 'ada', display_name: 'Ada Lovelace' },
          'idem-user-1',
        )
        expect(res.status).toBe(201)
      })
  })

  it('fetches an existing user', async () => {
    await pact
      .addInteraction()
      .given('a user exists', { user_id: EXAMPLE_USER_ID })
      .uponReceiving('a request to get an existing user')
      .withRequest('GET', `/api/users/${EXAMPLE_USER_ID}`)
      .willRespondWith(200, (b) => b.jsonBody(like(userBody)))
      .executeTest(async (mock) => {
        const res = await createIdentityClient(mock.url).getUser(EXAMPLE_USER_ID)
        expect(res.status).toBe(200)
      })
  })

  it('creates a community', async () => {
    await pact
      .addInteraction()
      .uponReceiving('a request to create a community')
      .withRequest('POST', '/api/communities', (b) =>
        b
          .headers({ 'content-type': 'application/json', 'Idempotency-Key': like('idem-comm-1') })
          .jsonBody({ slug: 'pactcommunity', name: 'Pact Community' }),
      )
      .willRespondWith(201, (b) => b.jsonBody(like(communityBody)))
      .executeTest(async (mock) => {
        const res = await createIdentityClient(mock.url).createCommunity(
          { slug: 'pactcommunity', name: 'Pact Community' },
          'idem-comm-1',
        )
        expect(res.status).toBe(201)
      })
  })

  it('adds a membership', async () => {
    await pact
      .addInteraction()
      .given('a community exists', { community_id: SECOND_COMMUNITY })
      .given('a user exists', { user_id: EXAMPLE_USER_ID })
      .uponReceiving('a request to add a membership')
      .withRequest('POST', `/api/communities/${SECOND_COMMUNITY}/members`, (b) =>
        b
          .headers({ 'content-type': 'application/json', 'Idempotency-Key': like('idem-mem-1') })
          .jsonBody({ user_id: EXAMPLE_USER_ID, role: 'member' }),
      )
      .willRespondWith(201, (b) => b.jsonBody(like(membershipBody)))
      .executeTest(async (mock) => {
        const res = await createIdentityClient(mock.url).addMembership(
          SECOND_COMMUNITY,
          { user_id: EXAMPLE_USER_ID, role: 'member' },
          'idem-mem-1',
        )
        expect(res.status).toBe(201)
      })
  })

  it('lists a community’s members', async () => {
    await pact
      .addInteraction()
      .given('a membership exists', {
        community_id: EXAMPLE_COMMUNITY_ID,
        user_id: EXAMPLE_USER_ID,
      })
      .uponReceiving('a request to list members')
      .withRequest('GET', `/api/communities/${EXAMPLE_COMMUNITY_ID}/members`)
      .willRespondWith(200, (b) =>
        b.jsonBody(
          like({
            community_id: regex(COMM_RE, EXAMPLE_COMMUNITY_ID),
            members: eachLike({
              user_id: regex(USER_RE, EXAMPLE_USER_ID),
              community_id: regex(COMM_RE, EXAMPLE_COMMUNITY_ID),
              role: regex(ROLE_RE, 'member'),
              joined_at: regex(ISO_RE, '2026-01-01T00:00:00.000Z'),
            }),
            as_of: like(asOfBody),
          }),
        ),
      )
      .executeTest(async (mock) => {
        const res = await createIdentityClient(mock.url).listMembers(EXAMPLE_COMMUNITY_ID)
        expect(res.status).toBe(200)
      })
  })

  it('issues a session access token', async () => {
    await pact
      .addInteraction()
      .given('a user exists', { user_id: EXAMPLE_USER_ID })
      .given('a signing key exists', { kid: EXAMPLE_KEY_ID })
      .uponReceiving('a request to create a session')
      .withRequest('POST', '/api/sessions', (b) =>
        b
          .headers({ 'content-type': 'application/json', 'Idempotency-Key': like('idem-sess-1') })
          .jsonBody({ user_id: EXAMPLE_USER_ID }),
      )
      .willRespondWith(201, (b) => b.jsonBody(like(sessionBody)))
      .executeTest(async (mock) => {
        const res = await createIdentityClient(mock.url).createSession(
          { user_id: EXAMPLE_USER_ID },
          'idem-sess-1',
        )
        expect(res.status).toBe(201)
      })
  })
})
