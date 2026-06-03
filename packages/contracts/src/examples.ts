/**
 * Canonical example values, single-sourced. Reused by OpenAPI examples (both
 * services), test harnesses, and the consumer pact — previously copied ~15×.
 */
export const EXAMPLE_COMMUNITY_ID = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD'
export const EXAMPLE_POST_ID = 'post_01HZY0K7M3QF8VN2J5RX9TB4CE'
export const EXAMPLE_USER_ID = 'user_01HZY0K7M3QF8VN2J5RX9TB4CF'
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
