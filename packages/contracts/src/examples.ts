/**
 * Canonical example values, single-sourced. Reused by OpenAPI examples (both
 * services), test harnesses, and the consumer pact — previously copied ~15×.
 */
export const EXAMPLE_COMMUNITY_ID = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD'
export const EXAMPLE_POST_ID = 'post_01HZY0K7M3QF8VN2J5RX9TB4CE'
export const EXAMPLE_USER_ID = 'user_01HZY0K7M3QF8VN2J5RX9TB4CF'
export const EXAMPLE_SESSION_ID = 'sess_01HZY0K7M3QF8VN2J5RX9TB4CG'
export const EXAMPLE_KEY_ID = 'key_01HZY0K7M3QF8VN2J5RX9TB4CH'
export const EXAMPLE_HANDLE = 'ada'
export const EXAMPLE_WHEN = '2026-05-28T12:00:00.000Z'

/** Example `Post` body used as the 200/201 OpenAPI example on both services. */
export const EXAMPLE_POST = {
  id: EXAMPLE_POST_ID,
  community_id: EXAMPLE_COMMUNITY_ID,
  author_id: EXAMPLE_USER_ID,
  title: 'Why deterministic clocks matter',
  body: 'A short note on testability.',
  score: 0,
  created_at: EXAMPLE_WHEN,
}

/** Example identity-service bodies, single-sourced for OpenAPI examples + the JWKS pact. */
export const EXAMPLE_USER = {
  id: EXAMPLE_USER_ID,
  handle: EXAMPLE_HANDLE,
  display_name: 'Ada Lovelace',
  created_at: EXAMPLE_WHEN,
}

export const EXAMPLE_COMMUNITY = {
  id: EXAMPLE_COMMUNITY_ID,
  slug: 'general',
  name: 'General',
  created_at: EXAMPLE_WHEN,
}

export const EXAMPLE_MEMBERSHIP = {
  user_id: EXAMPLE_USER_ID,
  community_id: EXAMPLE_COMMUNITY_ID,
  role: 'member',
  joined_at: EXAMPLE_WHEN,
}

/**
 * Example public EC P-256 JWK (the canonical RFC 7517 §A.1 coordinates). Illustrative
 * only — the JWKS pact matches structure via hand-authored regex, not these exact bytes.
 */
export const EXAMPLE_JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4',
  y: '4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM',
  kid: EXAMPLE_KEY_ID,
  use: 'sig',
  alg: 'ES256',
}
