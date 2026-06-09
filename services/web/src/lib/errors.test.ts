import { makeProblem } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/http'
import { messageFor } from './errors'

describe('messageFor', () => {
  it('prefers the RFC 7807 detail when the ApiError carries a problem with a detail', () => {
    const problem = makeProblem({
      slug: 'dependency-failure',
      title: 'Upstream donations-service unavailable',
      status: 502,
      failure_domain: 'dependency_failure',
      detail: 'The donations-service did not respond.',
      retryable: true,
    })
    const err = new ApiError(502, 'Upstream donations-service unavailable', problem)
    expect(messageFor(err)).toBe('The donations-service did not respond.')
  })

  it('falls back to the ApiError message when the problem has no detail', () => {
    const problem = makeProblem({
      slug: 'validation-failed',
      title: 'Validation failed',
      status: 422,
      failure_domain: 'validation',
      retryable: false,
    })
    const err = new ApiError(422, 'POST /flags → 422', problem)
    expect(messageFor(err)).toBe('POST /flags → 422')
  })

  it('returns the ApiError message when no problem is attached at all', () => {
    const err = new ApiError(500, 'GET /flags → 500')
    expect(messageFor(err)).toBe('GET /flags → 500')
  })

  it('returns the message of a plain Error', () => {
    expect(messageFor(new Error('boom'))).toBe('boom')
  })

  it('returns the message of a TypeError subclass of Error', () => {
    expect(messageFor(new TypeError('not a function'))).toBe('not a function')
  })

  it('returns the fallback string for a thrown string', () => {
    expect(messageFor('just a string')).toBe('Unexpected error')
  })

  it('returns the fallback string for a thrown plain object', () => {
    expect(messageFor({ message: 'looks like an error but is not one' })).toBe('Unexpected error')
  })

  it('returns the fallback string for null', () => {
    expect(messageFor(null)).toBe('Unexpected error')
  })

  it('returns the fallback string for undefined', () => {
    expect(messageFor(undefined)).toBe('Unexpected error')
  })
})
