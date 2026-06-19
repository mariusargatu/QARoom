import { test } from '@fast-check/vitest'
import {
  AddMembershipRequest,
  CastVoteRequest,
  CreateCommunityRequest,
  CreatePostRequest,
  CreateSessionRequest,
  CreateUserRequest,
  IdempotencyKey,
  Jwk,
  Jwks,
  ProblemDetails,
} from '@qaroom/contracts'
import { Ajv } from 'ajv'
import addFormats from 'ajv-formats'
import { describe, expect } from 'vitest'
import { z } from 'zod'
import { configureFastCheck } from '../fast-check-seed'
import {
  addMembershipRequestArb,
  castVoteRequestArb,
  createCommunityRequestArb,
  createPostRequestArb,
  createSessionRequestArb,
  createUserRequestArb,
  idempotencyKeyArb,
  jwkArb,
  jwksArb,
  problemDetailsArb,
} from './index'

/**
 * Zod ↔ OpenAPI round-trip (Milestone 0 exit criterion, docs/04). For each domain schema
 * and its generator, assert the value is ACCEPTED or REJECTED IDENTICALLY by (a) the
 * Zod parser — the single source of truth — and (b) the JSON Schema emitted for the
 * OpenAPI document. A divergence means either the generated OAS no longer mirrors Zod
 * (silent triangulation drift, docs/03 §6) or the generator produces data neither
 * describes (a "generator gap"). Parity is the invariant, NOT "both accept":
 * createPostRequestArb can emit a NUL byte that the NO_NUL pattern rejects on BOTH
 * sides — that agreement is exactly what proves the OAS pattern mirrors the Zod regex.
 */
configureFastCheck()

const cases = [
  { name: 'CreatePostRequest', schema: CreatePostRequest, arb: createPostRequestArb },
  { name: 'CastVoteRequest', schema: CastVoteRequest, arb: castVoteRequestArb },
  { name: 'ProblemDetails', schema: ProblemDetails, arb: problemDetailsArb },
  { name: 'IdempotencyKey', schema: IdempotencyKey, arb: idempotencyKeyArb },
  { name: 'CreateUserRequest', schema: CreateUserRequest, arb: createUserRequestArb },
  {
    name: 'CreateCommunityRequest',
    schema: CreateCommunityRequest,
    arb: createCommunityRequestArb,
  },
  { name: 'AddMembershipRequest', schema: AddMembershipRequest, arb: addMembershipRequestArb },
  { name: 'CreateSessionRequest', schema: CreateSessionRequest, arb: createSessionRequestArb },
  { name: 'Jwk', schema: Jwk, arb: jwkArb },
  { name: 'Jwks', schema: Jwks, arb: jwksArb },
] as const

function ajvAcceptorFor(schema: z.ZodType): (value: unknown) => boolean {
  const jsonSchema = z.toJSONSchema(schema, { target: 'openapi-3.0' }) as object
  const ajv = new Ajv({ strict: false, allErrors: true })
  addFormats(ajv)
  const validate = ajv.compile(jsonSchema)
  return (value) => validate(value) === true
}

describe('Zod ↔ OpenAPI generator round-trip', () => {
  for (const testCase of cases) {
    const ajvAccepts = ajvAcceptorFor(testCase.schema)
    test.prop([testCase.arb])(
      `${testCase.name}: emitted JSON Schema accepts/rejects each generated value exactly as the Zod parser does`,
      (value) => {
        const zodAccepts = testCase.schema.safeParse(value).success
        expect(ajvAccepts(value)).toBe(zodAccepts)
      },
    )
  }
})
