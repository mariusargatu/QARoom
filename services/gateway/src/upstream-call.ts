/**
 * One upstream HTTP call from the gateway, with a bounded timeout. The whole point of the
 * `AbortSignal.timeout` is chaos experiment 07: a network partition (blackhole) otherwise
 * hangs the socket until the OS TCP timeout (minutes), so the gateway's 502 never fires
 * promptly. A bounded abort turns a partition into a fast `dependency_failure`. A non-2xx
 * HTTP response is returned as data (the caller decides what it means); only transport
 * failures — connection refused/reset, DNS, timeout — throw.
 */
export interface ClientResponse {
  status: number
  body: unknown
  contentType: string | null
}

export interface UpstreamCallOptions {
  method: string
  path: string
  body?: unknown
  idempotencyKey?: string
  /**
   * A bearer credential to forward verbatim (e.g. `Authorization: Bearer <jwt>`). The gateway is a
   * dumb passthrough: it never decodes or verifies the token — the upstream (identity, on
   * `POST /ws/tickets`) verifies it against its own JWKS. Omitted by every other client.
   */
  authorization?: string
}

import { intFromEnv } from '@qaroom/service-kit'

const DEFAULT_TIMEOUT_MS = 5000

/**
 * The upstream call timeout, tunable via env so the experiment-07 demo can widen it. Via
 * `intFromEnv` so an empty/blank/non-numeric value falls back to the default rather than
 * collapsing to 0 (instant abort → every call 502s) or NaN (`AbortSignal.timeout(NaN)` throws).
 */
export function upstreamTimeoutMs(): number {
  return intFromEnv('GATEWAY_UPSTREAM_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)
}

/**
 * Parse a response body, tolerating non-JSON. A partition/proxy/sidecar often answers with an
 * HTML or plain-text 5xx; `JSON.parse` would throw, and the caller's catch would misclassify a
 * *delivered* response as a transport failure (corrupting circuit-breaker accounting). Returning
 * the raw text instead keeps the real HTTP status intact and lets `forward()` pass it through.
 */
function parseBody(text: string): unknown {
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function upstreamCall(
  baseUrl: string,
  opts: UpstreamCallOptions,
  timeoutMs: number,
): Promise<ClientResponse> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.idempotencyKey !== undefined) headers['idempotency-key'] = opts.idempotencyKey
  if (opts.authorization !== undefined) headers.authorization = opts.authorization

  const res = await fetch(`${baseUrl}${opts.path}`, {
    method: opts.method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  const contentType = res.headers.get('content-type')
  return { status: res.status, body: parseBody(text), contentType }
}

export interface UpstreamClientOptions {
  /** Per-call timeout; defaults to the shared upstream timeout (env-tunable). */
  timeoutMs?: number
}

/**
 * Bind a base URL + resolved timeout into a one-arg upstream caller — the construction ritual every
 * client repeated (`timeoutMs = options.timeoutMs ?? upstreamTimeoutMs()` then a `call` closure over
 * `upstreamCall`). A client now declares only its typed method-object. The resolved timeout is
 * captured once at construction, so every call the client makes shares the same bound deadline.
 */
export function boundCaller(
  baseUrl: string,
  options: UpstreamClientOptions = {},
): (opts: UpstreamCallOptions) => Promise<ClientResponse> {
  const timeoutMs = options.timeoutMs ?? upstreamTimeoutMs()
  return (opts) => upstreamCall(baseUrl, opts, timeoutMs)
}
