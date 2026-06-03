import { importJWK, jwtVerify, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { ProductionKeyMaterialSource } from './keys'

/**
 * The production key source uses real jose key generation, which every other test bypasses
 * via the fixed fixture. This smoke test exercises it directly so a jose API/extractability
 * regression surfaces here, not at runtime: it must produce an extractable ES256 EC keypair
 * whose private half signs a JWT the public half verifies.
 */
describe('ProductionKeyMaterialSource', () => {
  it('generates an extractable ES256 EC keypair whose private key signs a JWT the public key verifies', async () => {
    const { publicJwk, privateJwk } = await new ProductionKeyMaterialSource().generate()

    expect(publicJwk.kty).toBe('EC')
    expect(publicJwk.crv).toBe('P-256')
    expect(typeof publicJwk.x).toBe('string')
    expect(typeof publicJwk.y).toBe('string')
    expect(typeof privateJwk.d).toBe('string')

    const token = await new SignJWT({ ok: true })
      .setProtectedHeader({ alg: 'ES256' })
      .sign(await importJWK(privateJwk, 'ES256'))
    const { payload } = await jwtVerify(token, await importJWK(publicJwk, 'ES256'), {
      algorithms: ['ES256'],
    })
    expect(payload.ok).toBe(true)
  })
})
