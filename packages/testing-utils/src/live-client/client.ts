import { setTimeout as delay } from 'node:timers/promises'

/**
 * A thin, typed HTTP client for the live-cluster harnesses (the golden journey AND the chaos
 * probes). It talks to the live cluster THROUGH the gateway (the same edge a real client hits),
 * so a harness exercises the full request path — Traefik/Service -> gateway proxy -> downstream
 * service -> Postgres/NATS — not an in-process mock. One client instance == one caller's session.
 *
 * It enforces two repo conventions at the call site so a harness can't accidentally violate them:
 * every mutating request carries an `Idempotency-Key` (single-writer-per-resource), and the bearer
 * token (once a session exists) rides every request. The client never asserts — assertions live in
 * each harness (the journey's `commitments`, the chaos steady-state verdict). It only transports and
 * records, which is why it is generic enough to share: it is gateway-oriented, not journey-specific.
 */
export interface GatewayResponse {
  readonly status: number
  readonly body: unknown
}

export interface GatewayClientConfig {
  /** Base URL of the gateway, e.g. a local port-forward `http://localhost:18080`. */
  readonly baseUrl: string
  /** Per-request budget. A step that exceeds it is a failure, never a hang. */
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
 * deterministically from the seed so re-runs of the same harness produce the same keys.
 */
export class GatewayClient {
  private readonly config: GatewayClientConfig
  private counter = 0

  constructor(config: GatewayClientConfig) {
    this.config = config
  }

  private nextIdempotencyKey(): string {
    const n = this.counter
    this.counter += 1
    return `${this.config.idempotencySeed}-${n.toString().padStart(6, '0')}`
  }

  async get(path: string, opts: RequestOptions = {}): Promise<GatewayResponse> {
    return this.send('GET', path, undefined, opts)
  }

  /** A mutating call. Auto-attaches an `Idempotency-Key` unless the caller pins one (replay). */
  async post(path: string, body: unknown, opts: RequestOptions = {}): Promise<GatewayResponse> {
    const idempotencyKey = opts.idempotencyKey ?? this.nextIdempotencyKey()
    return this.send('POST', path, body, { ...opts, idempotencyKey })
  }

  private async send(
    method: string,
    path: string,
    body: unknown,
    opts: RequestOptions,
  ): Promise<GatewayResponse> {
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
      // A network-level failure (timeout, refused) is itself a harness failure: surface it as a
      // sentinel 0-status response so the caller asserts on it instead of throwing mid-walk.
      const detail = error instanceof Error ? error.message : String(error)
      return { status: 0, body: { transport_error: detail } }
    }
  }

  /** Poll a GET until `predicate` holds or the deadline passes — for at-least-once effects
   * (a webhook delivery, a moderator disposition) that land asynchronously after a write. */
  async pollUntil(
    path: string,
    predicate: (res: GatewayResponse) => boolean,
    opts: RequestOptions & { readonly withinMs: number; readonly everyMs: number },
  ): Promise<GatewayResponse> {
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

  /** Poll a POST until `predicate` holds or the deadline passes — for a write whose PRECONDITION
   * lands asynchronously (e.g. a donation gated until the flag-enable event propagates flags→NATS→
   * donations). Each attempt gets a fresh Idempotency-Key, so rejected tries store nothing and the
   * first accepted one is the sole effect. Polling the write is the only way to observe the consuming
   * service's local gate — the flags-service resolving `enabled` does not mean donations saw it yet. */
  async pollPostUntil(
    path: string,
    body: unknown,
    predicate: (res: GatewayResponse) => boolean,
    opts: RequestOptions & { readonly withinMs: number; readonly everyMs: number },
  ): Promise<GatewayResponse> {
    const deadline = opts.withinMs
    let waited = 0
    let last = await this.post(path, body, opts)
    while (!predicate(last) && waited < deadline) {
      await delay(opts.everyMs)
      waited += opts.everyMs
      last = await this.post(path, body, opts)
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
