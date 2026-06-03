import { FailureDomain } from '@qaroom/contracts'
import fc from 'fast-check'

/** Arbitrary valid RFC 7807 ProblemDetails (with the QARoom extensions). */
export const problemDetailsArb = fc.record({
  type: fc.webUrl(),
  title: fc.string({ minLength: 1, maxLength: 120 }),
  status: fc.integer({ min: 400, max: 599 }),
  retryable: fc.boolean(),
  next_actions: fc.constant([] as const),
  // Derived from the locked enum so a new contract domain flows in automatically.
  failure_domain: fc.constantFrom(...FailureDomain.options),
})
