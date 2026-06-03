import type { JWK } from 'jose'
import type { KeyMaterial, KeyMaterialSource } from '../../src/keys'

/**
 * Committed, fixed ES256 (P-256) key material so signatures and JWKS output are
 * byte-reproducible under the seeded determinism trio. Generated once with jose
 * `generateKeyPair('ES256')` + `exportJWK`. The ALIEN pair is a DIFFERENT, never-published
 * key used to prove the "signed by a key not in the JWKS" rejection.
 */
export const TEST_PUBLIC_JWK: JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'WcDbl05JanpokHTsRy0TWPZls5-i0Po5QaiYrm5ZIjw',
  y: 'Fqhvcwgcwt9QOdkm_Z25xVYEUylACKbEM_de6_kADDg',
}
export const TEST_PRIVATE_JWK: JWK = {
  ...TEST_PUBLIC_JWK,
  d: '7RobIsakTIgIMiaTYbNPhX-OYm7RhNEJeNxQpPP0Fqg',
}

export const ALIEN_PUBLIC_JWK: JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: '-SQV2ajAdsnE7amYXMtmwQElNm0XFk8gt0N6kFk-Zt4',
  y: 'wSGRgLw4RjSP_WG3w5AwO9lMbL3i06njV7uVnt4LJis',
}
export const ALIEN_PRIVATE_JWK: JWK = {
  ...ALIEN_PUBLIC_JWK,
  d: 'zAUqpk8g87LW_LXBvRueCrUj27nLWeXsBONcmm2ewWg',
}

/** A KeyMaterialSource that always returns the fixed TEST keypair (deterministic JWKS). */
export class TestKeyMaterialSource implements KeyMaterialSource {
  async generate(): Promise<KeyMaterial> {
    return { publicJwk: { ...TEST_PUBLIC_JWK }, privateJwk: { ...TEST_PRIVATE_JWK } }
  }
}
