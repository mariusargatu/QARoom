import type { Clock, Randomness } from '@qaroom/determinism'

/**
 * A minimal consecutive-failure circuit breaker — the donations-proxy mitigation for chaos
 * experiment 06 (the provider returns 500s). Once `threshold` calls fail in a row the breaker
 * opens: `allow()` returns false for a cooldown, so the gateway fails fast with a typed 502
 * instead of hammering a sick provider and leaking its raw 5xx to the client. After the
 * cooldown one half-open trial is permitted — success closes the breaker, failure re-opens it.
 *
 * Timing reads the injected `Clock`; the cooldown gets a little jitter from injected
 * `Randomness` so a fleet of gateways doesn't retry in lockstep. Never `Date.now()` /
 * `Math.random()` (Commitment 6, lint-enforced). Stateful by design, like `RateLimiter`.
 */
export interface CircuitBreakerConfig {
  /** Open after this many consecutive failures (transport error or upstream 5xx). */
  threshold: number
  /** Base time the breaker stays open before a half-open trial. */
  cooldownMs: number
  /** Fraction of `cooldownMs` added as random jitter, in [0, jitterRatio). Default 0.2. */
  jitterRatio?: number
}

type BreakerState = 'closed' | 'open' | 'half-open'

export class CircuitBreaker {
  private state: BreakerState = 'closed'
  private consecutiveFailures = 0
  private openedAtMs = 0
  private currentCooldownMs = 0
  // True while a single half-open trial is outstanding, so concurrent callers don't all probe a
  // still-sick provider at once (Node interleaves awaits even though it's single-threaded).
  private halfOpenTrialInFlight = false

  constructor(
    private readonly clock: Clock,
    private readonly randomness: Randomness,
    private readonly config: CircuitBreakerConfig,
  ) {}

  /**
   * Whether a call may proceed now. Closed → always. Open → only once the cooldown elapses, and
   * then admits exactly ONE half-open trial; further concurrent calls are refused until that
   * trial's `record()` resolves the state.
   */
  allow(): boolean {
    if (this.state === 'closed') return true
    if (this.state === 'open') {
      const elapsed = this.clock.now().getTime() - this.openedAtMs
      if (elapsed < this.currentCooldownMs) return false
      this.state = 'half-open'
      this.halfOpenTrialInFlight = true
      return true
    }
    // half-open: admit one trial at a time.
    if (this.halfOpenTrialInFlight) return false
    this.halfOpenTrialInFlight = true
    return true
  }

  /** Feed back the outcome of an allowed call. `ok` should be false for transport errors or 5xx. */
  record(ok: boolean): void {
    this.halfOpenTrialInFlight = false
    if (ok) {
      this.state = 'closed'
      this.consecutiveFailures = 0
      return
    }
    this.consecutiveFailures += 1
    if (this.consecutiveFailures >= this.config.threshold) {
      this.state = 'open'
      this.openedAtMs = this.clock.now().getTime()
      this.currentCooldownMs = this.jitteredCooldown()
    }
  }

  /** Inspectable for /system/state and tests. */
  get open(): boolean {
    return this.state === 'open'
  }

  private jitteredCooldown(): number {
    const ratio = this.config.jitterRatio ?? 0.2
    return Math.round(this.config.cooldownMs * (1 + this.randomness.next() * ratio))
  }
}

/** Raised when the breaker is open; the route's `forward()` maps it to a fast 502. */
export class CircuitOpenError extends Error {
  constructor() {
    super('circuit breaker open')
    this.name = 'CircuitOpenError'
  }
}
