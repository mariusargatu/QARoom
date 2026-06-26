import { makeProblem } from '@qaroom/contracts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/http'
import { messageFor } from './errors'

// Property tests for the pure `messageFor` error-projection (ADR-0005). The example-based
// `errors.test.ts` pins concrete cases; these pin the partition law across the whole input space:
// an Error projects to its own message, an ApiError prefers its RFC-7807 detail, and every other
// value collapses to the single constant fallback. Pure (no DOM/fetch/React), so it runs in node.

describe('messageFor invariants', () => {
  it('returns the exact message of any Error instance', () => {
    fc.assert(
      fc.property(fc.string(), (msg) => {
        expect(messageFor(new Error(msg))).toBe(msg)
      }),
    )
  })

  it('returns the exact message of any Error subclass instance', () => {
    fc.assert(
      fc.property(fc.string(), (msg) => {
        expect(messageFor(new TypeError(msg))).toBe(msg)
      }),
    )
  })

  it('collapses any non-Error, non-ApiError value to the single constant fallback', () => {
    const nonError = fc.oneof(
      fc.string(),
      fc.integer(),
      fc.double(),
      fc.boolean(),
      fc.constant(null),
      fc.constant(undefined),
      fc.object(),
      fc.array(fc.anything()),
    )
    fc.assert(
      fc.property(nonError, (value) => {
        expect(messageFor(value)).toBe('Unexpected error')
      }),
    )
  })

  it('prefers the RFC 7807 detail whenever an ApiError carries one', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 599 }),
        fc.string(),
        fc.string(),
        (status, message, detail) => {
          const problem = makeProblem({
            slug: 'x',
            title: 'y',
            status,
            failure_domain: 'validation',
            detail,
          })
          expect(messageFor(new ApiError(status, message, problem))).toBe(detail)
        },
      ),
    )
  })

  it('falls back to the ApiError message when its problem carries no detail', () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 599 }), fc.string(), (status, message) => {
        const problem = makeProblem({ slug: 'x', title: 'y', status, failure_domain: 'validation' })
        expect(messageFor(new ApiError(status, message, problem))).toBe(message)
      }),
    )
  })

  it('returns the ApiError message when no problem object is attached at all', () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 599 }), fc.string(), (status, message) => {
        expect(messageFor(new ApiError(status, message))).toBe(message)
      }),
    )
  })
})
