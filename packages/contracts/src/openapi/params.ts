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
export const userIdParam = brandedPathParam('userId', 'user', 'Target user.')

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
  /** Example `instance` path. Defaults to a content-service post path; identity overrides it. */
  instance?: string
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
      instance: opts.instance ?? `/api/posts/${EXAMPLE_POST_ID}`,
      retryable: opts.retryable,
      failure_domain: domain,
    }),
  }
}

/**
 * The RFC 7807 400 every service returns when edge/body/header validation fails. One canonical
 * wording instead of a `badRequest`/`validation400` helper re-spelled in each service.
 */
export function validationFailed(description: string, instance?: string): OasResponse {
  return problemResponse(400, 'validation-failed', 'Request failed validation', 'validation', {
    description,
    instance,
  })
}

/**
 * The 409 the shared Idempotency-Key middleware returns on key-reuse-with-a-different-body. Hoisted
 * here because every mutating service returned the same envelope, and the description had already
 * drifted between copies ("The" vs "This Idempotency-Key…").
 */
export function idempotencyConflict(instance?: string): OasResponse {
  return problemResponse(
    409,
    'idempotency-key-conflict',
    'Idempotency-Key reused with a different body',
    'conflict',
    {
      description: 'This Idempotency-Key was already used for a request with a different body.',
      retryable: false,
      instance,
    },
  )
}
