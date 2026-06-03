import { resolve } from 'node:path'
import { MatchersV3, PactV4 } from '@pact-foundation/pact'
import { EXAMPLE_JWK, EXAMPLE_KEY_ID } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { createJwksClient } from '../../src/jwks-client'

/**
 * Consumer-driven contract (Pact) for the identity-issuance boundary. The gateway declares
 * exactly what it needs from identity-service's JWKS; running this against the Pact mock
 * emits `services/gateway/pacts/gateway-identity.json`, which identity verifies as provider
 * (see services/identity/tests/contracts/provider.verify.ts). It also exercises the real
 * `jwks-client` fetch path.
 */
const { like, eachLike, regex } = MatchersV3

// Concrete example values single-sourced from contracts (examples.ts). The regex strings
// below stay hand-authored — they are the deliberate independent second source (docs/03 §6)
// and must NOT be derived from contracts.
const KID_RE = '^key_[0-9A-HJKMNP-TV-Z]{26}$'
const B64URL_RE = '^[A-Za-z0-9_-]+$'

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
