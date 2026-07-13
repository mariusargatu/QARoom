import {
  boundCaller,
  type ClientResponse,
  type UpstreamClientOptions,
} from '../resilience/upstream-call'

/**
 * HTTP client the gateway uses to call content-service. This is the **Pact consumer**: the
 * Milestone 1c consumer tests exercise this client against a Pact mock and emit the contract
 * content-service must verify. Keep it a thin, injectable seam — base URL in, normalized
 * response out. The call is bounded by `AbortSignal.timeout` (see `upstream-call.ts`).
 */
export type { ClientResponse } from '../resilience/upstream-call'

export interface ContentClient {
  getFeed(communityId: string): Promise<ClientResponse>
  getPost(postId: string): Promise<ClientResponse>
  createPost(communityId: string, body: unknown, idempotencyKey: string): Promise<ClientResponse>
  castVote(postId: string, body: unknown, idempotencyKey: string): Promise<ClientResponse>
}

export function createContentClient(
  baseUrl: string,
  options: UpstreamClientOptions = {},
): ContentClient {
  const call = boundCaller(baseUrl, options)
  return {
    getFeed: (communityId) => call({ method: 'GET', path: `/api/communities/${communityId}/feed` }),
    getPost: (postId) => call({ method: 'GET', path: `/api/posts/${postId}` }),
    createPost: (communityId, body, idempotencyKey) =>
      call({ method: 'POST', path: `/api/communities/${communityId}/posts`, body, idempotencyKey }),
    castVote: (postId, body, idempotencyKey) =>
      call({ method: 'POST', path: `/api/posts/${postId}/votes`, body, idempotencyKey }),
  }
}
