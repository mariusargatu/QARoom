import {
  brandedPathParam,
  communityIdParam,
  EXAMPLE_AS_OF,
  EXAMPLE_MODERATION_DECISION,
  type OasOperation,
  problemResponse,
} from '@qaroom/contracts'

/**
 * The moderation-decision reads the gateway proxies to the moderator-agent (ADR-0022, ADR-0018).
 * Read-only: the agent PROPOSES decisions and never enforces, so there is no mutating surface.
 * Split out of `operations.ts` to keep it under the 500-line cap; spread into OPERATIONS.
 */
const validation400 = problemResponse(
  400,
  'validation-failed',
  'Request failed validation',
  'validation',
  { description: 'The request failed validation at the gateway edge.' },
)
const moderatorUnreachable502 = problemResponse(
  502,
  'moderator-unreachable',
  'Upstream moderator-agent unavailable',
  'dependency_failure',
  { description: 'moderator-agent is unreachable or timed out.', retryable: true },
)
const decisionNotFound404 = problemResponse(
  404,
  'decision-not-found',
  'Moderation decision not found',
  'not_found',
  { description: 'No moderation decision with that id exists in this community.' },
)

const decisionIdParam = brandedPathParam('decisionId', 'mdec', 'Target moderation decision.')

export const MODERATION_OPERATIONS: readonly OasOperation[] = [
  {
    operationId: 'listModerationDecisions',
    method: 'get',
    path: '/api/communities/{communityId}/moderation-decisions',
    summary: 'List a community’s moderation decisions (proxied to moderator-agent)',
    description:
      'Returns the grounded moderation decisions the agent has recorded for a community, newest first, with a read envelope.',
    tags: ['moderation'],
    mutating: false,
    params: [communityIdParam],
    responses: [
      {
        code: 200,
        description: 'A page of moderation decisions.',
        bodyRef: 'ModerationDecisionList',
        example: { decisions: [EXAMPLE_MODERATION_DECISION], as_of: EXAMPLE_AS_OF },
      },
      validation400,
      moderatorUnreachable502,
    ],
  },
  {
    operationId: 'getModerationDecision',
    method: 'get',
    path: '/api/communities/{communityId}/moderation-decisions/{decisionId}',
    summary: 'Get a single moderation decision (proxied)',
    description: 'Returns one grounded moderation decision by id within a community.',
    tags: ['moderation'],
    mutating: false,
    params: [communityIdParam, decisionIdParam],
    responses: [
      {
        code: 200,
        description: 'The moderation decision.',
        bodyRef: 'ModerationDecision',
        example: EXAMPLE_MODERATION_DECISION,
      },
      validation400,
      decisionNotFound404,
      moderatorUnreachable502,
    ],
  },
]
