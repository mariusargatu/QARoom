import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CommunityId, PostId } from '../ids'
import { communityIdParam, postIdParam } from './params'

/**
 * Guard against the inverted-tautology trap (docs/03 §6): the OpenAPI path-param
 * pattern and the runtime branded-ID parser must derive from one source, or
 * Schemathesis could fuzz against an alphabet the parser rejects (or accept input
 * the parser would reject). Assert the param pattern equals what Zod emits for the
 * brand. If someone tightens the ULID alphabet in one place only, this fails loudly.
 */
function jsonSchemaPattern(schema: z.ZodType): string | undefined {
  const emitted = z.toJSONSchema(schema) as { pattern?: string }
  return emitted.pattern
}

describe('branded path params share one pattern source with the Zod parser', () => {
  it('postId param pattern equals the PostId schema pattern', () => {
    expect(postIdParam.schema.pattern).toBe(jsonSchemaPattern(PostId))
  })

  it('communityId param pattern equals the CommunityId schema pattern', () => {
    expect(communityIdParam.schema.pattern).toBe(jsonSchemaPattern(CommunityId))
  })
})
