import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODERATION_DECISION_RECORDED_VERSION } from './events/moderation-decision-recorded'
import { CommunityId } from './ids'
import {
  MODERATION_DECISION_RECORDED_ADDRESS,
  moderationDecisionRecorded,
  postCreated,
  postsCreatedAnyCommunity,
} from './subjects'

// packages/contracts/src → repo root is three levels up. Must stay byte-identical to the object
// `gen-moderator-contracts.ts` writes, so a change to subjects.ts that forgets `pnpm
// moderator:contracts` fails HERE (TS side), not only in the Python cross-language test.
const GOLDEN_PATH = resolve(
  import.meta.dirname,
  '../../../services/moderator-agent/contracts/subjects.golden.json',
)
const SAMPLE = CommunityId.parse('comm_00000000000000000000000000')

describe('the committed cross-language subjects golden tracks the TypeScript source', () => {
  it('is byte-identical to the generated subjects — run `pnpm moderator:contracts` after a subject change', () => {
    const committed = readFileSync(GOLDEN_PATH, 'utf8')
    const generated = `${JSON.stringify(
      {
        post_created: postCreated(SAMPLE),
        posts_created_any_community: postsCreatedAnyCommunity(),
        moderation_decision_recorded: moderationDecisionRecorded(SAMPLE),
        moderation_decision_recorded_address: MODERATION_DECISION_RECORDED_ADDRESS,
        moderation_decision_recorded_version: MODERATION_DECISION_RECORDED_VERSION,
      },
      null,
      2,
    )}\n`
    expect(committed).toBe(generated)
  })
})
