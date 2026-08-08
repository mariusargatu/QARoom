import { ApiError } from '../api/http'

/** Best human-readable message from an unknown error — prefers the RFC 7807 detail/title. */
export function messageFor(err: unknown): string {
  if (err instanceof ApiError) return err.problem?.detail ?? err.message
  if (err instanceof Error) return err.message
  return 'Unexpected error'
}

/**
 * Whether retrying could plausibly succeed, from the gateway's RFC 7807 `retryable` hint.
 *
 * `ApiError` has exposed `.retryable` since it was written and NOTHING read it: every failure
 * rendered the same "Try again" button, including a 400 or a 403 where retrying is guaranteed to
 * fail again. Non-ApiError failures (a thrown TypeError, a Zod parse) default to retryable — a
 * transport or transient fault is the likeliest cause and offering the action is the safer default.
 */
export function retryableFor(err: unknown): boolean {
  return err instanceof ApiError ? err.retryable : true
}
