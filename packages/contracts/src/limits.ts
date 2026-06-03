import { z } from 'zod'
import { AsOf } from './lamport'

/**
 * `GET /system/limits` (gateway). Per-principal rate-limit usage + reset time.
 * Note: the per-request `Retry-After` lives in the HTTP header, not here — the
 * RFC 7807 `ProblemDetails` envelope is frozen (Commitment 13/14).
 */
export const SystemLimits = z
  .object({
    service: z.string(),
    principal: z.string(),
    limit: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    /** Seconds until the bucket refills to full. Relative (like Retry-After), not a wall-clock instant. */
    reset_in_seconds: z.number().int().nonnegative(),
    as_of: AsOf,
  })
  .meta({
    id: 'SystemLimits',
    description: 'Per-principal rate-limit usage and time to full refill.',
  })
export type SystemLimits = z.infer<typeof SystemLimits>
