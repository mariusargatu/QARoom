import {
  communityIdParam,
  EXAMPLE_AS_OF,
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_FLAG_KEY,
  EXAMPLE_FLAG_RESOLUTION,
  idempotencyKeyHeaderParam,
  type OasOperation,
  type OasParam,
  problemResponse,
  SYSTEM_OPERATIONS,
  validationFailed,
} from '@qaroom/contracts'

/**
 * The canonical operation registry for flags-service. Single source for the committed
 * `openapi.yaml`, the `/system/capabilities` response, and the capabilities completeness
 * test. Routes are hand-wired but MUST stay in lockstep with this list.
 */
const FLAG_INSTANCE = `/api/communities/${EXAMPLE_COMMUNITY_ID}/flags/${EXAMPLE_FLAG_KEY}`

const flagKeyParam: OasParam = {
  name: 'flagKey',
  in: 'path',
  required: true,
  description: 'Feature-flag key (lowercase, hyphen-separated slug).',
  schema: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,63}$' },
}

const badRequest = (description: string) => validationFailed(description, FLAG_INSTANCE)

const rolloutConflict = problemResponse(
  409,
  'rollout-transition-illegal',
  'Illegal rollout transition',
  'conflict',
  {
    description: 'The requested event is not a legal transition from the flag’s current state.',
    instance: FLAG_INSTANCE,
  },
)

const EXAMPLE_FLAG_LIST = {
  community_id: EXAMPLE_COMMUNITY_ID,
  flags: [EXAMPLE_FLAG_RESOLUTION],
  as_of: EXAMPLE_AS_OF,
}

export const OPERATIONS: readonly OasOperation[] = [
  {
    operationId: 'resolveFlag',
    method: 'get',
    path: '/api/communities/{communityId}/flags/{flagKey}',
    summary: 'Resolve a feature flag for a community',
    description:
      'Returns the flag’s current rollout state and the gating boolean, with a read envelope.',
    tags: ['flags'],
    mutating: false,
    params: [communityIdParam, flagKeyParam],
    responses: [
      {
        code: 200,
        description: 'The resolved flag.',
        bodyRef: 'FlagResolution',
        example: EXAMPLE_FLAG_RESOLUTION,
      },
      badRequest('The community id or flag key in the path is malformed.'),
    ],
  },
  {
    operationId: 'listFlags',
    method: 'get',
    path: '/api/communities/{communityId}/flags',
    summary: 'List all flags for a community',
    description: 'Returns every flag resolved for the community, with a read envelope.',
    tags: ['flags'],
    mutating: false,
    params: [communityIdParam],
    responses: [
      {
        code: 200,
        description: 'The resolved flags.',
        bodyRef: 'FlagList',
        example: EXAMPLE_FLAG_LIST,
      },
      badRequest('The community id in the path is malformed.'),
    ],
  },
  {
    operationId: 'advanceRollout',
    method: 'post',
    path: '/api/communities/{communityId}/flags/{flagKey}/rollout',
    summary: 'Advance a flag rollout',
    description:
      'Applies one rollout event (e.g. EnableRequested). Idempotent on Idempotency-Key; an event illegal from the current state returns 409.',
    tags: ['flags'],
    mutating: true,
    params: [communityIdParam, flagKeyParam, idempotencyKeyHeaderParam],
    requestBodyRef: 'AdvanceRolloutRequest',
    requestExample: { event: 'EnableRequested' },
    responses: [
      {
        code: 200,
        description: 'The flag after the transition.',
        bodyRef: 'FlagResolution',
        example: EXAMPLE_FLAG_RESOLUTION,
        links: {
          ResolveFlag: {
            operationId: 'resolveFlag',
            parameters: {
              communityId: '$response.body#/community_id',
              flagKey: '$response.body#/flag_key',
            },
            description: 'Re-resolve the flag that was just advanced.',
          },
        },
      },
      rolloutConflict,
      badRequest('The request body or headers failed validation.'),
    ],
  },
  ...SYSTEM_OPERATIONS,
]
