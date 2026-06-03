import { z } from 'zod'

/**
 * RFC 7807 Problem Details, extended for agents (Commitment 13, docs/05).
 * Every non-2xx response is `application/problem+json` and validates against
 * `ProblemDetails`. The three agent-actionable extensions are mandatory:
 * `retryable`, `next_actions`, `failure_domain`.
 */

/** Closed enum maintained here (Commitment 13). New domains require a contract change. */
export const FailureDomain = z
  .enum([
    'validation',
    'authentication',
    'authorization',
    'tenant_resolution',
    'rate_limit',
    'conflict',
    'not_found',
    'dependency_failure',
    'internal_error',
  ])
  .meta({ id: 'FailureDomain' })
export type FailureDomain = z.infer<typeof FailureDomain>

export const HttpVerb = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

/** A machine-actionable next step an agent (or client) can take after an error. */
export const NextAction = z
  .object({
    verb: HttpVerb,
    href: z.string(),
    description: z.string(),
  })
  .meta({ id: 'NextAction' })
export type NextAction = z.infer<typeof NextAction>

export const ProblemDetails = z
  .object({
    type: z.string().describe('Absolute URI identifying the problem type.'),
    title: z.string(),
    status: z.number().int().min(100).max(599),
    detail: z.string().optional(),
    instance: z.string().optional(),
    retryable: z.boolean(),
    next_actions: z.array(NextAction),
    failure_domain: FailureDomain,
  })
  .meta({
    id: 'ProblemDetails',
    description: 'RFC 7807 Problem Details with QARoom agent extensions.',
  })
export type ProblemDetails = z.infer<typeof ProblemDetails>

export const ERROR_TYPE_BASE = 'https://qaroom.dev/errors'

export interface ProblemInput {
  slug: string
  title: string
  status: number
  failure_domain: FailureDomain
  detail?: string
  instance?: string
  retryable?: boolean
  next_actions?: NextAction[]
}

/** Build a validated ProblemDetails. `retryable` defaults to false. */
export function makeProblem(input: ProblemInput): ProblemDetails {
  return ProblemDetails.parse({
    type: `${ERROR_TYPE_BASE}/${input.slug}`,
    title: input.title,
    status: input.status,
    detail: input.detail,
    instance: input.instance,
    retryable: input.retryable ?? false,
    next_actions: input.next_actions ?? [],
    failure_domain: input.failure_domain,
  })
}
