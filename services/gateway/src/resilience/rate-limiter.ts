import type { Clock } from '@qaroom/determinism'

/**
 * In-memory token-bucket rate limiter (Milestone 1; swappable for Redis later). Refill
 * is computed from the injected Clock, so behaviour is fully deterministic under a
 * FakeClock — which is what lets the property test pin time and assert the
 * capacity invariant exactly.
 */
export interface RateLimitConfig {
  capacity: number
  refillPerSec: number
}

export interface RateLimitDecision {
  allowed: boolean
  remaining: number
  /** Seconds until one more token is available; 0 unless this call was denied. */
  retryAfterSec: number
  /** Seconds until the bucket is back at full capacity (relative, computed once). */
  secondsToFull: number
}

interface Bucket {
  tokens: number
  lastRefillMs: number
}

export class RateLimiter {
  readonly #clock: Clock
  readonly #capacity: number
  readonly #refillPerSec: number
  readonly #buckets = new Map<string, Bucket>()

  constructor(clock: Clock, config: RateLimitConfig) {
    this.#clock = clock
    this.#capacity = config.capacity
    this.#refillPerSec = config.refillPerSec
  }

  get capacity(): number {
    return this.#capacity
  }

  #refill(key: string): Bucket {
    const now = this.#clock.now().getTime()
    const existing = this.#buckets.get(key) ?? { tokens: this.#capacity, lastRefillMs: now }
    const elapsedSec = Math.max(0, (now - existing.lastRefillMs) / 1000)
    const tokens = Math.min(this.#capacity, existing.tokens + elapsedSec * this.#refillPerSec)
    const bucket: Bucket = { tokens, lastRefillMs: now }
    this.#buckets.set(key, bucket)
    return bucket
  }

  #decide(bucket: Bucket, denied: boolean): RateLimitDecision {
    // Both quantities are relative seconds derived from the bucket fill computed in
    // #refill against a single clock read. The route exposes secondsToFull verbatim —
    // no second clock read, so reset_in_seconds cannot drift under a moving clock.
    const deficitToFull = this.#capacity - bucket.tokens
    const secondsToFull = this.#refillPerSec > 0 ? Math.ceil(deficitToFull / this.#refillPerSec) : 0
    const retryAfterSec =
      denied && this.#refillPerSec > 0
        ? Math.max(1, Math.ceil((1 - bucket.tokens) / this.#refillPerSec))
        : 0
    return { allowed: !denied, remaining: Math.floor(bucket.tokens), retryAfterSec, secondsToFull }
  }

  /** Read current state without consuming a token (for /system/limits). */
  peek(key: string): RateLimitDecision {
    return this.#decide(this.#refill(key), false)
  }

  /** Consume one token if available; returns the decision. */
  consume(key: string): RateLimitDecision {
    const bucket = this.#refill(key)
    const allowed = bucket.tokens >= 1
    if (allowed) bucket.tokens -= 1
    return this.#decide(bucket, !allowed)
  }
}
