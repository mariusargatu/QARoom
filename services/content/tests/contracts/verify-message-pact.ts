/**
 * A minimal, dependency-free PROVIDER verifier for a Pact v3/v4 message contract. Pact's own
 * message-provider verifier replays the message through a provider state machine; here we instead
 * check a concrete envelope the producer ACTUALLY emitted (captured off the relay) against the
 * consumer's pinned `contents`/`metadata` examples + `matchingRules`. That closes the gap the
 * consumer message-pact leaves open: the consumer proved it can PARSE a shape, never that content
 * PUBLISHES that shape (the contract was, until now, fictional on the provider side).
 *
 * Supported matchers (all the consumer pact uses): `regex` (field must match) and `type` (field's
 * runtime type must equal the example's). A field present in the example with NO rule is treated as
 * an exact-equality expectation. Returns a list of human-readable mismatches; empty ⇒ verified.
 */

// `match` is typed as `string` (not a union) because the rules come from external pact JSON — an
// unrecognized matcher must be REPORTED, not silently treated as "no constraint".
interface Matcher {
  match: string
  regex?: string
}

interface RuleSet {
  [path: string]: { matchers: Matcher[] }
}

function checkField(
  label: string,
  field: string,
  actual: unknown,
  rule: { matchers: Matcher[] } | undefined,
  example: unknown,
): string[] {
  // A wire field that is absent or null is never valid for these envelopes. Fail BEFORE any matcher:
  // otherwise `String(undefined) === 'undefined'` can satisfy a loose lowercase regex, verifying a
  // missing field as present (the silent false-negative the review flagged).
  if (actual === undefined || actual === null) {
    return [`${label}.${field}: missing (got ${JSON.stringify(actual)})`]
  }
  // No rule ⇒ the example is an exact-match expectation (e.g. the literal `event-name`).
  if (!rule) {
    return actual === example
      ? []
      : [
          `${label}.${field}: expected exact ${JSON.stringify(example)}, got ${JSON.stringify(actual)}`,
        ]
  }
  // A rule with no matchers verifies nothing — a malformed contract, not a free pass.
  if (rule.matchers.length === 0) {
    return [`${label}.${field}: matchingRule has no matchers (field would go unverified)`]
  }
  const failures: string[] = []
  for (const matcher of rule.matchers) {
    if (matcher.match === 'regex') {
      if (matcher.regex === undefined) {
        failures.push(`${label}.${field}: regex matcher has no pattern`)
      } else if (!new RegExp(matcher.regex).test(String(actual))) {
        failures.push(
          `${label}.${field}: ${JSON.stringify(actual)} does not match /${matcher.regex}/`,
        )
      }
    } else if (matcher.match === 'type') {
      if (typeof actual !== typeof example) {
        failures.push(`${label}.${field}: type ${typeof actual} !== expected ${typeof example}`)
      }
    } else {
      failures.push(`${label}.${field}: unsupported matcher '${matcher.match}'`)
    }
  }
  return failures
}

function verifySection(
  label: string,
  actual: Record<string, unknown>,
  example: Record<string, unknown>,
  rules: RuleSet,
  ignoreKeys: readonly string[],
  // Pact keys body rules by JSONPath (`$.field`) but metadata rules by bare name. The caller
  // supplies the right form so the rule lookup never silently misses (a miss would degrade a
  // regex-matched field to an exact-match and fail on a deterministic-but-different id).
  ruleKey: (key: string) => string,
): string[] {
  const failures: string[] = []
  for (const key of Object.keys(example)) {
    if (ignoreKeys.includes(key)) continue
    failures.push(...checkField(label, key, actual[key], rules[ruleKey(key)], example[key]))
  }
  return failures
}

export interface PactMessage {
  description: string
  contents: Record<string, unknown>
  metadata: Record<string, unknown>
  matchingRules: { body?: RuleSet; metadata?: RuleSet }
}

export interface CapturedEnvelope {
  payload: Record<string, unknown>
  headers: Record<string, unknown>
}

/**
 * Verify a captured producer envelope against one consumer pact message. `contentType` in the
 * pact metadata is Pact plumbing (not a wire header content sets), so it is ignored.
 */
export function verifyEnvelopeAgainstMessage(
  envelope: CapturedEnvelope,
  message: PactMessage,
): string[] {
  return [
    ...verifySection(
      'body',
      envelope.payload,
      message.contents,
      message.matchingRules.body ?? {},
      [],
      (key) => `$.${key}`,
    ),
    ...verifySection(
      'metadata',
      envelope.headers,
      message.metadata,
      message.matchingRules.metadata ?? {},
      ['contentType'],
      (key) => key,
    ),
  ]
}
