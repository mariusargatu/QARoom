import SwaggerParser from '@apidevtools/swagger-parser'
import { Ajv } from 'ajv'
import addFormats from 'ajv-formats'

/**
 * Milestone 0 spike 3: a thin wrapper that cross-checks a Pact interaction against the
 * OpenAPI operation it claims to exercise (Commitment 3 triangulation). It loads
 * and dereferences the OAS via swagger-parser, finds the operation by method+path,
 * and validates the interaction's response body against the operation's response
 * schema with Ajv.
 *
 * What this catches that nothing else does: STRUCTURAL drift between a consumer's
 * Pact expectation and the provider's PUBLISHED OpenAPI — a path/method/status the
 * consumer relies on that the spec never documents, or a response SHAPE the spec no
 * longer permits. It deliberately does NOT check example VALUES (two different valid
 * ULIDs both pass); value-level conformance is the provider-verify step's job, and
 * crash/5xx behaviour is Schemathesis's. Keep the three orthogonal (docs/03 §6).
 */
type Json = Record<string, unknown>

export interface InteractionLike {
  request: { method: string; path: string }
  response: { status: number; body?: unknown }
}

export interface CrosscheckResult {
  ok: boolean
  operationId?: string
  errors: string[]
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

  const content = response.content as Json | undefined
  const media = (content?.['application/json'] ?? content?.['application/problem+json']) as
    | Json
    | undefined
  const schema = media?.schema as object | undefined
  if (!schema) {
    return { ok: true, operationId, errors: [] }
  }

  const ajv = new Ajv({ strict: false, allErrors: true })
  addFormats(ajv)
  const validate = ajv.compile(schema)
  if (validate(interaction.response.body)) {
    return { ok: true, operationId, errors: [] }
  }
  return {
    ok: false,
    operationId,
    errors: (validate.errors ?? []).map(
      (e) => `${e.instancePath || '(root)'} ${e.message ?? 'invalid'}`,
    ),
  }
}
