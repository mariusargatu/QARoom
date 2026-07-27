import { describe, expect, it } from 'vitest'
import {
  committedSpecText,
  configMapSpecText,
  contractShape,
  expectedMockPath,
  hasEncodedParens,
  importJobChecksum,
  mockIdentity,
  paymentBaseUrl,
  specChecksum,
} from './lib/microcks-spec'

/**
 * Gates for the Microcks payment mock. Everything asserted here was verified LIVE against
 * microcks-uber 1.11.0 (the pinned image) before being written down: the spec was uploaded through
 * the same `/api/artifact/upload` call the in-cluster import Job makes, and the URL below returned
 * `200 {"id":"pay_...","status":"captured"}`.
 *
 * Until now the only evidence the mock worked was a prose comment in values.yaml.
 */
const ROOT = process.cwd()

describe('the two copies of the payment contract stay in sync', () => {
  it('serves the same paths and schemas from the ConfigMap as the committed spec declares', () => {
    // Microcks serves the ConfigMap copy; every doc, ADR and reader points at the committed one.
    // Compared semantically, not byte-wise: the committed file carries prose the deployment
    // artifact does not need, and flow vs block YAML style is not a contract difference.
    expect(contractShape(configMapSpecText(ROOT))).toEqual(contractShape(committedSpecText(ROOT)))
  })

  it('gives both copies the same info.title and info.version, which the mock URL is built from', () => {
    expect(mockIdentity(configMapSpecText(ROOT))).toEqual(mockIdentity(committedSpecText(ROOT)))
  })
})

describe('PAYMENT_PROVIDER_BASE_URL stays coupled to what Microcks will serve', () => {
  it('ends with the mock path derived from the spec info, so a title rename cannot 404 silently', () => {
    const url = paymentBaseUrl(ROOT)
    const expected = expectedMockPath(mockIdentity(configMapSpecText(ROOT)))
    expect(url.endsWith(expected)).toBe(true)
  })

  it('keeps parens literal — percent-encoding them is the measured 404 cause', () => {
    // Measured on microcks-uber 1.11.0: `(mock)` -> 200, `%28mock%29` -> 404, independent of
    // whether spaces are `%20` or `+`. The parens are the whole story.
    expect(hasEncodedParens(paymentBaseUrl(ROOT))).toBe(false)
  })

  it('points at the in-cluster Microcks Service, not localhost or an external host', () => {
    expect(paymentBaseUrl(ROOT)).toMatch(
      /^http:\/\/qaroom-microcks\.observability\.svc\.cluster\.local:8080\//,
    )
  })
})

describe('the encoded-paren detector recognises the forms that 404', () => {
  it('flags both %28 and %29 in either case, and passes a literal-paren URL', () => {
    expect([
      hasEncodedParens('/rest/QARoom%20Payment%20Provider%20(mock)/1.0.0'),
      hasEncodedParens('/rest/QARoom%20Payment%20Provider%20%28mock%29/1.0.0'),
      hasEncodedParens('/rest/QARoom+Payment+Provider+%28mock%29/1.0.0'),
      hasEncodedParens('/rest/x%29/1.0.0'),
    ]).toEqual([false, true, true, true])
  })
})

describe('the import Job re-runs when the spec changes', () => {
  it('names the Job after the current spec checksum, so an edited spec forces a fresh import', () => {
    // A fixed-name Job is never re-created by `kubectl apply` (its pod template is immutable), so
    // without this the mock keeps serving the artifact from the FIRST apply. The failure message
    // gives you the name to paste.
    const expected = specChecksum(configMapSpecText(ROOT))
    expect(importJobChecksum(ROOT)).toBe(expected)
  })
})
