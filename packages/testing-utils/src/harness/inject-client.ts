import type { FastifyInstance } from 'fastify'

/** Normalized response shape for assertions, shared by every service's test harness. */
export interface NormalizedResponse {
  status: number
  contentType: string | undefined
  headers: Record<string, unknown>
  json: unknown
}

export interface RequestClient {
  get(url: string): Promise<NormalizedResponse>
  post(url: string, body: unknown, headers?: Record<string, string>): Promise<NormalizedResponse>
}

/** Wrap a Fastify instance's `inject` into an ergonomic get/post client returning JSON. */
export function injectClient(app: FastifyInstance): RequestClient {
  const normalize = (result: {
    statusCode: number
    headers: Record<string, unknown>
    body: string
  }): NormalizedResponse => ({
    status: result.statusCode,
    contentType: result.headers['content-type'] as string | undefined,
    headers: result.headers,
    json: result.body ? JSON.parse(result.body) : undefined,
  })

  return {
    async get(url) {
      return normalize(await app.inject({ method: 'GET', url }))
    },
    async post(url, body, headers = {}) {
      return normalize(
        await app.inject({
          method: 'POST',
          url,
          headers: { 'content-type': 'application/json', ...headers },
          payload: body as object,
        }),
      )
    },
  }
}
