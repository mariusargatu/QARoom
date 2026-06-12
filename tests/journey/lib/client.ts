import { setTimeout as delay } from 'node:timers/promises'

/**
 * A thin, typed HTTP client for the golden-journey harness. It talks to the live cluster
 * THROUGH the gateway (the same edge a real client hits), so the journey exercises the full
 * request path — Traefik/Service -> gateway proxy -> downstream service -> Postgres/NATS — not
 * an in-process mock. One client instance == one user's session.
 *
 * It enforces two repo conventions at the call site so the journey can't accidentally violate
 * them: every mutating request carries an `Idempotency-Key` (single-writer-per-resource), and
 * the bearer token (once a session exists) rides every request. The client never asserts —
 * assertions live in the test and in `./commitments`. It only transports and records.
 */
export interface JourneyResponse {
  readonly status: number
  readonly body: unknown
}

export interface JourneyClientConfig {
  /** Base URL of the gateway, e.g. the local port-forward `http://localhost:18080`. */
  readonly baseUrl: string
  /** Per-request budget. A journey step that exceeds it is a failure, never a hang. */
  readonly requestBudgetMs: number
  /** Deterministic seed for Idempotency-Key generation (no Math.random in the harness). */
  readonly idempotencySeed: string
}

interface RequestOptions {
  readonly token?: string
  readonly idempotencyKey?: string
}

/**
 * Immutable client. Each call returns a new response record; the client itself holds no
 * mutable per-request state beyond the monotonic idempotency counter, which is derived
 * deterministically from the seed so re-runs of the same journey produce the same keys.
 */
export class JourneyClient {
  private readonly config: JourneyClientConfig
  private counter = 0

  constructor(config: JourneyClientConfig) {
    this.config = config
  }

  private nextIdempotencyKey(): string {
    const n = this.counter
    this.counter += 1
    return `${this.config.idempotencySeed}-${n.toString().padStart(6, '0')}`
  }

  async get(path: string, opts: RequestOptions = {}): Promise<JourneyResponse> {
    return this.send('GET', path, undefined, opts)
  }

  /** A mutating call. Auto-attaches an `Idempotency-Key` unless the caller pins one (replay). */
  async post(path: string, body: unknown, opts: RequestOptions = {}): Promise<JourneyResponse> {
    const idempotencyKey = opts.idempotencyKey ?? this.nextIdempotencyKey()
    return this.send('POST', path, body, { ...opts, idempotencyKey })
  }

  private async send(
    method: string,
    path: string,
    body: unknown,
    opts: RequestOptions,
  ): Promise<JourneyResponse> {
    const headers = new Headers({ accept: 'application/json' })
    if (body !== undefined) headers.set('content-type', 'application/json')
    if (opts.token) headers.set('authorization', `Bearer ${opts.token}`)
    if (opts.idempotencyKey) headers.set('idempotency-key', opts.idempotencyKey)

    try {
      const res = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.requestBudgetMs),
      })
      const text = await res.text()
      const parsed = text.length > 0 ? safeJson(text) : null
      return { status: res.status, body: parsed }
    } catch (error) {
      // A network-level failure (timeout, refused) is itself a journey failure: surface it as a
      // sentinel 0-status response so the test asserts on it instead of throwing mid-walk.
      const detail = error instanceof Error ? error.message : String(error)
      return { status: 0, body: { transport_error: detail } }
    }
  }

  /** Poll a GET until `predicate` holds or the deadline passes — for at-least-once effects
   * (a webhook delivery, a moderator disposition) that land asynchronously after a write. */
  async pollUntil(
    path: string,
    predicate: (res: JourneyResponse) => boolean,
    opts: RequestOptions & { readonly withinMs: number; readonly everyMs: number },
  ): Promise<JourneyResponse> {
    const deadline = opts.withinMs
    let waited = 0
    let last = await this.get(path, opts)
    while (!predicate(last) && waited < deadline) {
      await delay(opts.everyMs)
      waited += opts.everyMs
      last = await this.get(path, opts)
    }
    return last
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return { non_json_body: text }
  }
}
