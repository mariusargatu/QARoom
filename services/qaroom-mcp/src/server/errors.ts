import { makeProblem, ProblemDetails } from '@qaroom/contracts'

/**
 * Tool failures map to the closed FailureDomain enum via the shared `makeProblem()`,
 * so a calling agent gets `retryable` / `next_actions` / `failure_domain` — structured
 * recovery, not an opaque string (ADR-0006, Gate 2). All builders return a validated
 * ProblemDetails.
 */
export function toolNotFoundProblem(name: string): ProblemDetails {
  return makeProblem({
    slug: 'mcp-tool-not-found',
    title: 'Unknown MCP tool',
    status: 404,
    failure_domain: 'not_found',
    detail: `No tool named "${name}" is registered.`,
    next_actions: [{ verb: 'GET', href: 'mcp://tools', description: 'List the available tools.' }],
  })
}

export function invalidToolInputProblem(name: string, detail: string): ProblemDetails {
  return makeProblem({
    slug: 'mcp-tool-input-invalid',
    title: 'Tool input failed validation',
    status: 400,
    failure_domain: 'validation',
    detail,
    next_actions: [
      { verb: 'GET', href: `mcp://tools/${name}`, description: 'Re-read the tool input_schema.' },
    ],
  })
}

export function dependencyFailureProblem(service: string, detail: string): ProblemDetails {
  return makeProblem({
    slug: 'mcp-upstream-unreachable',
    title: 'Backing service unreachable',
    status: 502,
    failure_domain: 'dependency_failure',
    retryable: true,
    detail: `${service}: ${detail}`,
    next_actions: [
      {
        verb: 'GET',
        href: 'mcp://resources/qaroom://gateway/system/state',
        description: 'Check service state, then retry.',
      },
    ],
  })
}

export function resourceNotFoundProblem(uri: string): ProblemDetails {
  return makeProblem({
    slug: 'mcp-resource-not-found',
    title: 'Unknown MCP resource',
    status: 404,
    failure_domain: 'not_found',
    detail: `No resource at ${uri}.`,
    next_actions: [
      { verb: 'GET', href: 'mcp://resources', description: 'List the available resources.' },
    ],
  })
}

export function internalToolProblem(name: string, detail: string): ProblemDetails {
  return makeProblem({
    slug: 'mcp-tool-internal-error',
    title: 'Tool failed',
    status: 500,
    failure_domain: 'internal_error',
    detail: `${name}: ${detail}`,
  })
}

/**
 * Pass an upstream service's RFC 7807 body through unchanged when it already conforms
 * (the backing services all emit Problem Details); otherwise wrap it as a dependency
 * failure so the envelope stays well-formed.
 */
export function upstreamProblem(
  service: string,
  response: { status: number; body: unknown },
): ProblemDetails {
  const parsed = ProblemDetails.safeParse(response.body)
  if (parsed.success) return parsed.data
  return dependencyFailureProblem(
    service,
    `upstream returned ${response.status} with a non-conforming body`,
  )
}
