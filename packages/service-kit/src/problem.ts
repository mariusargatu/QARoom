import {
  type FailureDomain,
  makeProblem,
  type NextAction,
  type ProblemDetails,
} from '@qaroom/contracts'
import { recordOnActiveSpan } from '@qaroom/otel'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { ZodError } from 'zod'

/**
 * The one RFC 7807 problem handler for every QARoom service (Commitment 13). Maps
 * ZodError + parse/content-type faults → 400, missing routes → 404, and anything
 * else → 500 with NO underlying message (no sensitive-data leak). `ProblemError`
 * carries optional headers (e.g. `Retry-After` on a 429).
 */
export class ProblemError extends Error {
  readonly problem: ProblemDetails
  readonly headers: Record<string, string>

  constructor(problem: ProblemDetails, headers: Record<string, string> = {}) {
    super(problem.title)
    this.name = 'ProblemError'
    this.problem = problem
    this.headers = headers
  }
}

export interface ProblemSpec {
  slug: string
  title: string
  status: number
  failure_domain: FailureDomain
  detail?: string
  retryable?: boolean
  next_actions?: NextAction[]
  /** Extra HTTP headers to send with the problem (e.g. `Retry-After` on a 429). */
  headers?: Record<string, string>
}

export function problem(spec: ProblemSpec): ProblemError {
  return new ProblemError(makeProblem(spec), spec.headers)
}

function sendProblem(
  reply: FastifyReply,
  p: ProblemDetails,
  headers: Record<string, string> = {},
): void {
  reply.code(p.status).header('content-type', 'application/problem+json')
  for (const [key, value] of Object.entries(headers)) reply.header(key, value)
  reply.send(p)
}

/**
 * The status to report when an error is the client's fault, or `undefined` when
 * it is ours (→ 500). A 4xx-tagged error, a malformed-JSON `SyntaxError`, and a
 * Fastify content-type-parser fault (`FST_ERR_CTP*`) are all client faults.
 */
function clientFaultStatus(err: unknown): number | undefined {
  const e = err as { statusCode?: number; code?: string }
  if (e.statusCode !== undefined && e.statusCode >= 400 && e.statusCode < 500) return e.statusCode
  if (err instanceof SyntaxError) return 400
  if (typeof e.code === 'string' && e.code.startsWith('FST_ERR_CTP')) return 400
  return undefined
}

export function registerProblemHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ProblemError) {
      sendProblem(reply, { ...err.problem, instance: req.url }, err.headers)
      return
    }
    if (err instanceof ZodError) {
      sendProblem(
        reply,
        makeProblem({
          slug: 'validation-failed',
          title: 'Request failed validation',
          status: 400,
          failure_domain: 'validation',
          detail: err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
          instance: req.url,
        }),
      )
      return
    }
    const clientStatus = clientFaultStatus(err)
    if (clientStatus !== undefined) {
      sendProblem(
        reply,
        makeProblem({
          slug: 'bad-request',
          title: 'Bad request',
          status: clientStatus,
          failure_domain: 'validation',
          detail: 'The request could not be parsed or failed validation.',
          instance: req.url,
        }),
      )
      return
    }
    // `Fastify({ logger: false })` is the design default for every QARoom service, so
    // `req.log.error` is a no-op. A genuine server fault must still surface somewhere: record
    // the exception on the live Fastify request span (`getActiveSpan()` is valid here — we are
    // inside the request span's context) and mark it ERROR, so an internal 500 is never silent.
    req.log.error(err)
    recordOnActiveSpan(err, { markError: true })
    sendProblem(
      reply,
      makeProblem({
        slug: 'internal-error',
        title: 'Internal server error',
        status: 500,
        failure_domain: 'internal_error',
        detail: 'An unexpected error occurred.',
        instance: req.url,
        retryable: true,
      }),
    )
  })

  app.setNotFoundHandler((req, reply) => {
    sendProblem(
      reply,
      makeProblem({
        slug: 'route-not-found',
        title: 'Route not found',
        status: 404,
        failure_domain: 'not_found',
        detail: `No route for ${req.method} ${req.url}`,
        instance: req.url,
      }),
    )
  })
}
