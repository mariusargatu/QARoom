/**
 * HTTP client the gateway uses to call content-service. This is the **Pact
 * consumer**: the Milestone 1c consumer tests exercise this client against a Pact
 * mock and emit the contract content-service must verify. Keep it a thin,
 * injectable seam — base URL in, normalized response out.
 */
export interface ClientResponse {
  status: number
  body: unknown
  contentType: string | null
}

export interface ContentClient {
  getFeed(communityId: string): Promise<ClientResponse>
  getPost(postId: string): Promise<ClientResponse>
  createPost(communityId: string, body: unknown, idempotencyKey: string): Promise<ClientResponse>
  castVote(postId: string, body: unknown, idempotencyKey: string): Promise<ClientResponse>
}

interface CallOptions {
  method: string
  path: string
  body?: unknown
  idempotencyKey?: string
}

export function createContentClient(baseUrl: string): ContentClient {
  async function call(opts: CallOptions): Promise<ClientResponse> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (opts.body !== undefined) headers['content-type'] = 'application/json'
    if (opts.idempotencyKey !== undefined) headers['idempotency-key'] = opts.idempotencyKey

    const res = await fetch(`${baseUrl}${opts.path}`, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
    const text = await res.text()
    const contentType = res.headers.get('content-type')
    return { status: res.status, body: text.length > 0 ? JSON.parse(text) : undefined, contentType }
  }

  return {
    getFeed: (communityId) => call({ method: 'GET', path: `/api/communities/${communityId}/feed` }),
    getPost: (postId) => call({ method: 'GET', path: `/api/posts/${postId}` }),
    createPost: (communityId, body, idempotencyKey) =>
      call({ method: 'POST', path: `/api/communities/${communityId}/posts`, body, idempotencyKey }),
    castVote: (postId, body, idempotencyKey) =>
      call({ method: 'POST', path: `/api/posts/${postId}/votes`, body, idempotencyKey }),
  }
}
