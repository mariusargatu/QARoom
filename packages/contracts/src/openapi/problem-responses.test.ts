import { describe, expect, it } from 'vitest'
import { ProblemDetails } from '../errors'
import {
  idempotencyConflict,
  idempotencyKeyHeaderParam,
  problemResponse,
  userIdParam,
  validationFailed,
} from './params'

describe('problemResponse', () => {
  it('builds an RFC 7807 error entry whose example validates against ProblemDetails', () => {
    const res = problemResponse(404, 'post-not-found', 'Post not found', 'not_found', {
      description: 'No such post in this community.',
    })
    expect(res.code).toBe(404)
    expect(res.bodyRef).toBe('ProblemDetails')
    expect(res.contentType).toBe('application/problem+json')
    expect(ProblemDetails.safeParse(res.example).success).toBe(true)
  })

  it('threads the retryable flag and a custom instance into the worked example', () => {
    const res = problemResponse(503, 'dep-down', 'Dependency unavailable', 'dependency_failure', {
      description: 'Upstream is unavailable.',
      retryable: true,
      instance: '/api/communities/comm_x',
    })
    const example = res.example as { retryable: boolean; instance: string; failure_domain: string }
    expect(example.retryable).toBe(true)
    expect(example.instance).toBe('/api/communities/comm_x')
    expect(example.failure_domain).toBe('dependency_failure')
  })
})

describe('validationFailed', () => {
  it('produces the canonical 400 validation problem response', () => {
    const res = validationFailed('Body failed validation.')
    expect(res.code).toBe(400)
    const example = res.example as { failure_domain: string; type: string }
    expect(example.failure_domain).toBe('validation')
    expect(example.type).toContain('validation-failed')
  })
})

describe('idempotencyConflict', () => {
  it('produces a non-retryable 409 key-reuse problem response', () => {
    const res = idempotencyConflict('/api/communities/comm_x/posts')
    expect(res.code).toBe(409)
    const example = res.example as { retryable: boolean; failure_domain: string }
    expect(example.retryable).toBe(false)
    expect(example.failure_domain).toBe('conflict')
  })
})

describe('shared OpenAPI param building blocks', () => {
  it('derives the userId path-param pattern from the branded-id source', () => {
    expect(userIdParam.schema.pattern).toContain('user_')
    expect(userIdParam.required).toBe(true)
  })

  it('describes the mandatory idempotency-key header bounded in length', () => {
    expect(idempotencyKeyHeaderParam.in).toBe('header')
    expect(idempotencyKeyHeaderParam.schema.maxLength).toBe(255)
  })
})
