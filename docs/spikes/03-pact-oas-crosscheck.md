# Spike 3: Pact ↔ OpenAPI cross-check

- **Milestone affected:** 1 (contract testing)
- **Question:** Can we build a thin `@apidevtools/swagger-parser`-based wrapper that
  verifies a Pact interaction stays consistent with the provider's OpenAPI operation?
- **Verdict:** ✅ **PASS**

## Method

Built `packages/testing-utils/src/contract-crosscheck/index.ts`:
`crosscheckInteraction(oas, interaction)` dereferences the OAS via swagger-parser,
matches the operation by method + templated path, and validates the interaction's
response body against the operation's response schema with Ajv (`ajv` + `ajv-formats`).

Proven by `contract-crosscheck/index.test.ts` (3/3):
- a conforming interaction passes (`ok: true`, resolves `operationId`),
- an interaction missing a required response field is flagged (`ok: false`, errors listed),
- an interaction on a path absent from the contract is flagged.

## Result

The wrapper detects exactly the silent-drift case it targets: a consumer Pact
expectation that no longer matches the provider's published contract. No heavyweight
Pact tooling needed for the check itself: the interaction shape is plain JSON.

## Consequence

Milestone 1 wires this cross-check into the contract-test job: every Pact interaction is
additionally validated against the committed `openapi.yaml`. No ADR amendment needed.
