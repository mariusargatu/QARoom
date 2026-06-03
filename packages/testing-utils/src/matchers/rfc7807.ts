import {
  type FailureDomain,
  type ProblemDetails,
  ProblemDetails as ProblemDetailsSchema,
} from '@qaroom/contracts'

export interface RFC7807Expectation {
  status?: number
  failureDomain?: FailureDomain
}

/**
 * Assert a value is a valid RFC 7807 problem with the QARoom extensions
 * (`retryable`, `next_actions`, `failure_domain`). Throws on mismatch — usable
 * directly in tests. Returns the parsed problem for further assertions.
 */
export function expectRFC7807(value: unknown, expected: RFC7807Expectation = {}): ProblemDetails {
  const problem = ProblemDetailsSchema.parse(value)
  if (expected.status !== undefined && problem.status !== expected.status) {
    throw new Error(`expected problem status ${expected.status}, got ${problem.status}`)
  }
  if (expected.failureDomain !== undefined && problem.failure_domain !== expected.failureDomain) {
    throw new Error(
      `expected failure_domain "${expected.failureDomain}", got "${problem.failure_domain}"`,
    )
  }
  return problem
}

/** Assert that a content-type header is `application/problem+json` (charset allowed). */
export function expectProblemContentType(contentType: string | undefined): void {
  if (contentType === undefined || !contentType.startsWith('application/problem+json')) {
    throw new Error(`expected application/problem+json content-type, got "${contentType}"`)
  }
}
