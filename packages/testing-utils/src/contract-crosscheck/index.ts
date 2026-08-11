import SwaggerParser from '@apidevtools/swagger-parser'
import { Ajv } from 'ajv'
import addFormats from 'ajv-formats'
import { toJsonSchema } from './oas-schema'

/**
 * Milestone 0 spike 3: a thin wrapper that cross-checks a Pact interaction against the
 * OpenAPI operation it claims to exercise (Commitment 3 triangulation). It loads
 * and dereferences the OAS via swagger-parser, finds the operation by method+path,
 * and validates BOTH halves of the interaction — request body against the operation's
 * `requestBody` schema, response body against its response schema — with Ajv.
 *
 * What this catches that nothing else does: STRUCTURAL drift between a consumer's
 * Pact expectation and the provider's PUBLISHED OpenAPI — a path/method/status the
 * consumer relies on that the spec never documents, or a request/response SHAPE the
 * spec no longer permits. It deliberately does NOT check example VALUES (two different
 * valid ULIDs both pass); value-level conformance is the provider-verify step's job,
 * and crash/5xx behaviour is Schemathesis's. Keep the three orthogonal (docs/03 §6).
 *
 * Two holes closed 2026-08-11, both of which made this return `ok: true` having checked
 * nothing:
 *  - the REQUEST body was never looked at, so a consumer could pin a body its provider's
 *    own spec forbids. Provider verification would not catch it either — it replays the
 *    pact's body, so it agrees with the consumer rather than with the spec.
 *  - a declared response with NO schema passed unconditionally. That silently excused
 *    every bodiless status (webhooks' `DELETE → 204` was live in this state) and would
 *    have excused a response whose schema was deleted from the spec. A missing schema is
 *    now only acceptable when the interaction carries no body either.
 */
export { type NamedInteraction, pactInteractions } from './pact-file'

type Json = Record<string, unknown>

export interface InteractionLike {
  /** `body` is the consumer's pinned request example — validated against the OAS `requestBody`. */
  request: { method: string; path: string; body?: unknown }
  response: { status: number; body?: unknown }
}

export interface CrosscheckResult {
  ok: boolean
  operationId?: string
  errors: string[]
}

/** The JSON (or Problem+JSON) schema of an OAS `content` map, if it declares one. */
function mediaSchema(content: Json | undefined): object | undefined {
  const media = (content?.['application/json'] ?? content?.['application/problem+json']) as
    | Json
    | undefined
  return media?.schema as object | undefined
}

/**
 * Whether a pact recorded a body at all. `undefined`/`null` mean "no body"; everything else — `{}`
 * and `''` included — is a body the spec has to account for.
 */
function isPresent(body: unknown): boolean {
  return body !== undefined && body !== null
}

function matchTemplates(templates: string[], actualPath: string): string[] {
  return templates.filter((template) => {
    const pattern = new RegExp(`^${template.replace(/\{[^/]+\}/g, '[^/]+')}$`)
    return pattern.test(actualPath)
  })
}

export async function crosscheckInteraction(
  oas: string | Json,
  interaction: InteractionLike,
): Promise<CrosscheckResult> {
  const api = (await SwaggerParser.dereference(oas as never)) as unknown as {
    paths: Record<string, Json>
  }

  const matches = matchTemplates(Object.keys(api.paths), interaction.request.path)
  if (matches.length === 0) {
    return { ok: false, errors: [`no OAS path matches ${interaction.request.path}`] }
  }
  // Fail loudly on ambiguity rather than silently picking the first match: a future
  // literal path (e.g. /posts/featured) overlapping a templated one (/posts/{postId})
  // would otherwise be validated against the wrong operation — a false pass.
  if (matches.length > 1) {
    return {
      ok: false,
      errors: [
        `ambiguous: ${matches.length} OAS paths match ${interaction.request.path} (${matches.join(', ')})`,
      ],
    }
  }
  const template = matches[0] as string

  const pathItem = api.paths[template] as Json
  const operation = pathItem[interaction.request.method.toLowerCase()] as Json | undefined
  if (!operation) {
    return { ok: false, errors: [`no ${interaction.request.method} on ${template}`] }
  }
  const operationId = operation.operationId as string | undefined

  const responses = operation.responses as Json
  const response = responses[String(interaction.response.status)] as Json | undefined
  if (!response) {
    return {
      ok: false,
      operationId,
      errors: [`no ${interaction.response.status} response declared`],
    }
  }

  const ajv = new Ajv({ strict: false, allErrors: true })
  addFormats(ajv)

  /**
   * Validate one body against a media-type schema, prefixing errors with which half failed.
   * `relaxRequired` is the request/response asymmetry — see `oas-schema.ts` for why a response
   * pact legitimately omits required fields while a request pact never does.
   */
  const check = (
    label: string,
    schema: object,
    body: unknown,
    relaxRequired: boolean,
  ): string[] => {
    const validate = ajv.compile(toJsonSchema(schema, { relaxRequired }))
    if (validate(body)) return []
    return (validate.errors ?? []).map(
      (e) => `${label}${e.instancePath || ' (root)'} ${e.message ?? 'invalid'}`,
    )
  }

  const errors: string[] = []

  // REQUEST. Previously unchecked entirely: a consumer could pin a request body the provider's own
  // spec forbids (a dropped required field, a renamed property) and every gate stayed green —
  // provider verification replays the pact's body, so it agrees with the consumer, not the spec.
  const requestSchema = mediaSchema((operation.requestBody as Json | undefined)?.content as Json)
  if (requestSchema) {
    errors.push(...check('request', requestSchema, interaction.request.body, false))
  } else if (isPresent(interaction.request.body)) {
    errors.push(`request body sent but ${template} declares no requestBody schema`)
  }

  // RESPONSE. A declared response with NO schema used to return ok:true unconditionally, which made
  // every bodiless status (webhooks' DELETE → 204) a vacuous pass — and would have silently excused
  // a response whose schema was dropped from the spec. Absence of a schema is now only acceptable
  // when the interaction also carries no body.
  const responseSchema = mediaSchema(response.content as Json | undefined)
  if (responseSchema) {
    errors.push(...check('response', responseSchema, interaction.response.body, true))
  } else if (isPresent(interaction.response.body)) {
    errors.push(
      `response body present but ${interaction.response.status} on ${template} declares no schema`,
    )
  }

  return { ok: errors.length === 0, operationId, errors }
}
