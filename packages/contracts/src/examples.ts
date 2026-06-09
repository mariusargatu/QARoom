/**
 * Canonical example values, single-sourced. Reused by OpenAPI examples (both
 * services), test harnesses, and the consumer pact — previously copied ~15×.
 */
export const EXAMPLE_COMMUNITY_ID = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD'
export const EXAMPLE_POST_ID = 'post_01HZY0K7M3QF8VN2J5RX9TB4CE'
export const EXAMPLE_USER_ID = 'user_01HZY0K7M3QF8VN2J5RX9TB4CF'
export const EXAMPLE_SESSION_ID = 'sess_01HZY0K7M3QF8VN2J5RX9TB4CG'
export const EXAMPLE_KEY_ID = 'key_01HZY0K7M3QF8VN2J5RX9TB4CH'
export const EXAMPLE_DONATION_ID = 'dntn_01HZY0K7M3QF8VN2J5RX9TB4CJ'
export const EXAMPLE_TICKET_ID = 'tkt_01HZY0K7M3QF8VN2J5RX9TB4CK'
export const EXAMPLE_WEBHOOK_SUBSCRIPTION_ID = 'whsub_01HZY0K7M3QF8VN2J5RX9TB4CM'
export const EXAMPLE_WEBHOOK_DELIVERY_ID = 'whdel_01HZY0K7M3QF8VN2J5RX9TB4CN'
export const EXAMPLE_WEBHOOK_URL = 'https://hooks.example.com/qaroom'
export const EXAMPLE_FLAG_KEY = 'donations'
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

/** Example read envelope, single-sourced for the Milestone-5 flag/event OpenAPI examples. */
export const EXAMPLE_AS_OF = {
  snapshot_id: 'snap_01HZY0K7M3QF8VN2J5RX9TB4CL',
  lamport: 7,
  wall_clock: EXAMPLE_WHEN,
}

/** Example resolved flag (the donations rollout sitting Enabled) for OpenAPI examples. */
export const EXAMPLE_FLAG_RESOLUTION = {
  community_id: EXAMPLE_COMMUNITY_ID,
  flag_key: EXAMPLE_FLAG_KEY,
  state: 'Enabled',
  enabled: true,
  as_of: EXAMPLE_AS_OF,
}

/** Example donation (a captured $25 gift) for OpenAPI examples + the donations pact. */
export const EXAMPLE_DONATION = {
  id: EXAMPLE_DONATION_ID,
  community_id: EXAMPLE_COMMUNITY_ID,
  donor_id: EXAMPLE_USER_ID,
  amount_cents: 2500,
  currency: 'USD',
  status: 'Captured',
  created_at: EXAMPLE_WHEN,
  updated_at: EXAMPLE_WHEN,
}

/** Example webhook subscription (an Active https endpoint) for OpenAPI examples + the pact. */
export const EXAMPLE_WEBHOOK_SUBSCRIPTION = {
  id: EXAMPLE_WEBHOOK_SUBSCRIPTION_ID,
  community_id: EXAMPLE_COMMUNITY_ID,
  url: EXAMPLE_WEBHOOK_URL,
  event_types: ['post.created', 'donation.state.changed'],
  status: 'Active',
  created_at: EXAMPLE_WHEN,
  updated_at: EXAMPLE_WHEN,
}

/** Example webhook delivery (a delivered post.created) for OpenAPI examples. */
export const EXAMPLE_WEBHOOK_DELIVERY = {
  id: EXAMPLE_WEBHOOK_DELIVERY_ID,
  subscription_id: EXAMPLE_WEBHOOK_SUBSCRIPTION_ID,
  community_id: EXAMPLE_COMMUNITY_ID,
  event_id: 'evt_01HZY0K7M3QF8VN2J5RX9TB4CP',
  event_type: 'post.created',
  status: 'Delivered',
  attempt: 1,
  next_attempt_at: null,
  last_status_code: 200,
  created_at: EXAMPLE_WHEN,
  updated_at: EXAMPLE_WHEN,
}

export const EXAMPLE_DECISION_ID = 'mdec_01HZY0K7M3QF8VN2J5RX9TB4CQ'

/** Example moderation decision (a clean approve) for OpenAPI examples + the moderation reads. */
export const EXAMPLE_MODERATION_DECISION = {
  decision_id: EXAMPLE_DECISION_ID,
  event_id: 'evt_01HZY0K7M3QF8VN2J5RX9TB4CP',
  post_id: EXAMPLE_POST_ID,
  community_id: EXAMPLE_COMMUNITY_ID,
  author_id: EXAMPLE_USER_ID,
  disposition: 'approve',
  cited_rules: [],
  precedents: [],
  departs_from_precedent: false,
  rationale: 'No policy rule matched; the post is clearly within the community guidelines.',
  confidence: 0.97,
  model: 'openai:gpt-5.5-2026-04-23',
  created_at: EXAMPLE_WHEN,
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
