import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CommunityId,
  MODERATION_DECISION_RECORDED_ADDRESS,
  MODERATION_DECISION_RECORDED_VERSION,
  moderationDecisionRecorded,
  moderationDecisionRecordedJsonSchema,
  postCreated,
  postsCreatedAnyCommunity,
} from '@qaroom/contracts'

/**
 * Emit the cross-language contract artifacts the Python moderator-agent validates against
 * (Milestone 9). Zod/`subjects.ts` are the single source of truth (conventions §2/§3); the Python
 * side mirrors them, and these committed files are the drift gate in BOTH languages:
 *
 *   1. moderation-decision-recorded.schema.json — the event wire format (Pydantic ↔ Zod).
 *   2. subjects.golden.json — the NATS subjects the moderator uses (Python builders ↔ subjects.ts).
 *
 * Run after any change to the event schema or the subject grammar:  pnpm moderator:contracts
 */
const ROOT = process.cwd()
const outDir = resolve(ROOT, 'services/moderator-agent/contracts')
mkdirSync(outDir, { recursive: true })

const schemaOut = resolve(outDir, 'moderation-decision-recorded.schema.json')
writeFileSync(schemaOut, `${JSON.stringify(moderationDecisionRecordedJsonSchema(), null, 2)}\n`)
process.stdout.write(`wrote ${schemaOut}\n`)

// A fixed sample community so the golden is stable across runs.
const SAMPLE = CommunityId.parse('comm_00000000000000000000000000')
const subjects = {
  post_created: postCreated(SAMPLE),
  posts_created_any_community: postsCreatedAnyCommunity(),
  moderation_decision_recorded: moderationDecisionRecorded(SAMPLE),
  moderation_decision_recorded_address: MODERATION_DECISION_RECORDED_ADDRESS,
  // Pinned here so the Python event-version header (`subjects.py`) can be cross-checked against the
  // TS source of truth — otherwise a 1→2 bump on one side only would pass every gate silently (R1).
  moderation_decision_recorded_version: MODERATION_DECISION_RECORDED_VERSION,
}
const subjectsOut = resolve(outDir, 'subjects.golden.json')
writeFileSync(subjectsOut, `${JSON.stringify(subjects, null, 2)}\n`)
process.stdout.write(`wrote ${subjectsOut}\n`)
