import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { moderationDecisionRecordedJsonSchema } from './moderation-decision-recorded'

// packages/contracts/src/events → repo root is four levels up.
const SCHEMA_PATH = resolve(
  import.meta.dirname,
  '../../../../services/moderator-agent/contracts/moderation-decision-recorded.schema.json',
)

describe('the committed cross-language JSON Schema tracks the Zod source', () => {
  it('is byte-identical to the generated schema — run `pnpm moderator:contracts` after a schema change', () => {
    const committed = readFileSync(SCHEMA_PATH, 'utf8')
    const generated = `${JSON.stringify(moderationDecisionRecordedJsonSchema(), null, 2)}\n`
    expect(committed).toBe(generated)
  })
})
