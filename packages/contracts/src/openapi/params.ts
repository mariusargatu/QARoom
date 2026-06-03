import { type FailureDomain, makeProblem } from '../errors'
import { EXAMPLE_POST_ID } from '../examples'
import { brandedIdPattern } from '../ids'
import type { OasParam, OasResponse } from './builder'

/** Shared OpenAPI building blocks so every service describes the common shapes identically. */

export function brandedPathParam(name: string, prefix: string, description: string): OasParam {
  return {
    name,
    in: 'path',
    required: true,
    description,
    // Pattern derives from ids.ts — same source the runtime branded-ID parser uses.
    schema: { type: 'string', pattern: brandedIdPattern(prefix) },
  }
}

export const communityIdParam = brandedPathParam(
  'communityId',
  'comm',
  'Target community (tenant).',
)
export const postIdParam = brandedPathParam('postId', 'post', 'Target post.')

export const idempotencyKeyHeaderParam: OasParam = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  description: 'Client-supplied key making this mutation safely retryable (Commitment 4).',
  schema: { type: 'string', minLength: 1, maxLength: 255 },
}

const PROBLEM_CONTENT_TYPE = 'application/problem+json'

export interface ProblemResponseOptions {
  description: string
  retryable?: boolean
}

/** An RFC 7807 error response entry with a worked example (single source for both services). */
export function problemResponse(
  code: number,
  slug: string,
  title: string,
  domain: FailureDomain,
  opts: ProblemResponseOptions,
): OasResponse {
  return {
    code,
    description: opts.description,
    bodyRef: 'ProblemDetails',
    contentType: PROBLEM_CONTENT_TYPE,
    // The example is built by the same makeProblem() the runtime uses, so it is
    // parsed against ProblemDetails — a wrong shape fails loudly here, not in prod.
    example: makeProblem({
      slug,
      title,
      status: code,
      detail: `${title}.`,
      instance: `/api/posts/${EXAMPLE_POST_ID}`,
      retryable: opts.retryable,
      failure_domain: domain,
    }),
  }
}
