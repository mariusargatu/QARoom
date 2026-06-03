import { describe, expect, it } from 'vitest'
import { makeProblem, ProblemDetails } from './errors'

describe('makeProblem', () => {
  it('derives the type URI from the slug and defaults retryable to false', () => {
    const problem = makeProblem({
      slug: 'post-not-found',
      title: 'Post not found',
      status: 404,
      failure_domain: 'not_found',
    })
    expect(problem.type).toBe('https://qaroom.dev/errors/post-not-found')
    expect(problem.retryable).toBe(false)
    expect(problem.next_actions).toEqual([])
  })

  it('produces a value that satisfies the ProblemDetails schema', () => {
    const problem = makeProblem({
      slug: 'rate-limited',
      title: 'Too many requests',
      status: 429,
      failure_domain: 'rate_limit',
      retryable: true,
    })
    expect(() => ProblemDetails.parse(problem)).not.toThrow()
  })
})
