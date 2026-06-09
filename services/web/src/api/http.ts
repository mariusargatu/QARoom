import { ProblemDetails } from '@qaroom/contracts'
import type { IdGenerator } from '@qaroom/determinism'

/**
 * A typed error carrying the gateway's RFC 7807 Problem Details (Commitment: every non-2xx is a
 * Problem). The UI reads `failure_domain` / `retryable` / `next_actions` to render a precise error
 * state instead of a generic "something went wrong".
 */
export class ApiError extends Error {
  readonly status: number
  readonly problem?: ProblemDetails

  constructor(status: number, message: string, problem?: ProblemDetails) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.problem = problem
  }

  get failureDomain(): string | undefined {
    return this.problem?.failure_domain
  }

  get retryable(): boolean {
    return this.problem?.retryable ?? false
  }
}

export interface PostOptions {
  /** Send an Idempotency-Key (Commitment 4). Default true; the WS-ticket mint opts out. */
  idempotent?: boolean
  /** A bearer credential to attach (only the WS-ticket mint needs it). */
  authorization?: string
}

export interface Http {
  get<T>(path: string, parse: (raw: unknown) => T): Promise<T>
  post<T>(
    path: string,
    body: unknown,
    parse: (raw: unknown) => T,
    options?: PostOptions,
  ): Promise<T>
  del(path: string): Promise<void>
}

async function toApiError(res: Response, method: string, path: string): Promise<ApiError> {
  const text = await res.text().catch(() => '')
  let problem: ProblemDetails | undefined
  if (text) {
    const parsed = ProblemDetails.safeParse(safeJson(text))
    if (parsed.success) problem = parsed.data
  }
  const message = problem?.title ?? `${method} ${path} → ${res.status}`
  return new ApiError(res.status, message, problem)
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * The browser's gateway HTTP core. Idempotency keys come from the injected `IdGenerator`
 * (Commitment 6 — not `crypto.randomUUID()`/`Date.now()`, which the determinism lint bans even in
 * the browser). A ULID is GLOBALLY unique across reloads/sessions, so a key is never reused — a
 * plain per-load counter resets to the same value on every page load and would replay a *stale*
 * idempotency response from a prior request (a real mutation-after-reload bug).
 */
export function createHttp(baseUrl: string, ids: IdGenerator): Http {
  const base = baseUrl.replace(/\/$/, '')
  const nextKey = () => ids.next('web')

  return {
    async get<T>(path: string, parse: (raw: unknown) => T): Promise<T> {
      const res = await fetch(`${base}${path}`, { headers: { accept: 'application/json' } })
      if (!res.ok) throw await toApiError(res, 'GET', path)
      return parse(await res.json())
    },

    async post<T>(
      path: string,
      body: unknown,
      parse: (raw: unknown) => T,
      options: PostOptions = {},
    ): Promise<T> {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json',
      }
      if (options.idempotent !== false) headers['idempotency-key'] = nextKey()
      if (options.authorization) headers.authorization = options.authorization
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body ?? {}),
      })
      if (!res.ok) throw await toApiError(res, 'POST', path)
      return parse(await res.json())
    },

    async del(path: string): Promise<void> {
      const res = await fetch(`${base}${path}`, {
        method: 'DELETE',
        headers: { accept: 'application/json', 'idempotency-key': nextKey() },
      })
      if (!res.ok) throw await toApiError(res, 'DELETE', path)
    },
  }
}
