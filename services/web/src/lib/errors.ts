import { ApiError } from '../api/http'

/** Best human-readable message from an unknown error — prefers the RFC 7807 detail/title. */
export function messageFor(err: unknown): string {
  if (err instanceof ApiError) return err.problem?.detail ?? err.message
  if (err instanceof Error) return err.message
  return 'Unexpected error'
}
