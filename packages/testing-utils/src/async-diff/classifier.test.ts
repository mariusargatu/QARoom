import { describe, expect, it } from 'vitest'
import { asyncapiBreakingChanges, classifyAsyncChange } from './index'

describe('the AsyncAPI rule table classifies structural payload changes', () => {
  it('treats removing a payload property as breaking', () => {
    const result = classifyAsyncChange(
      { action: 'remove', path: '/components/schemas/PostCreatedEvent/properties/community_id' },
      'send',
    )
    expect(result.classification).toBe('breaking')
  })

  it('treats adding a payload property as non-breaking', () => {
    const result = classifyAsyncChange(
      { action: 'add', path: '/components/schemas/PostCreatedEvent/properties/edited_at' },
      'send',
    )
    expect(result.classification).toBe('nonBreaking')
  })

  it('treats changing a payload property type as breaking', () => {
    const result = classifyAsyncChange(
      { action: 'edit', path: '/components/schemas/PostCreatedEvent/properties/post_id/type' },
      'send',
    )
    expect(result.classification).toBe('breaking')
  })

  it('treats removing a channel as breaking and adding one as non-breaking', () => {
    expect(
      classifyAsyncChange({ action: 'remove', path: '/channels/postCreated' }, 'send')
        .classification,
    ).toBe('breaking')
    expect(
      classifyAsyncChange({ action: 'add', path: '/channels/voteCast' }, 'send').classification,
    ).toBe('nonBreaking')
  })

  it('treats a version bump as non-breaking — it signals a change, it is not one', () => {
    expect(
      classifyAsyncChange({ action: 'edit', path: '/info/version' }, 'send').classification,
    ).toBe('nonBreaking')
  })
})

describe('the required-field rule is direction-aware — the trap the spike flagged', () => {
  const requiredChange = (action: 'add' | 'remove') => ({
    action,
    path: '/components/schemas/PostCreatedEvent/required/2',
  })

  it('for a sent message, adding a required field is breaking and removing one is not', () => {
    expect(classifyAsyncChange(requiredChange('add'), 'send').classification).toBe('breaking')
    expect(classifyAsyncChange(requiredChange('remove'), 'send').classification).toBe('nonBreaking')
  })

  it('for a received message, removing a required field is breaking and adding one is not', () => {
    expect(classifyAsyncChange(requiredChange('remove'), 'receive').classification).toBe('breaking')
    expect(classifyAsyncChange(requiredChange('add'), 'receive').classification).toBe('nonBreaking')
  })
})

const baseDoc = {
  asyncapi: '3.0.0',
  info: { title: 'fixture', version: '1.0.0' },
  channels: {
    postCreated: {
      address: 'qaroom.content.posts.{community_id}.created',
      messages: { PostCreatedEvent: { $ref: '#/components/messages/PostCreatedEvent' } },
    },
  },
  operations: {
    publishPostCreated: {
      action: 'send',
      channel: { $ref: '#/channels/postCreated' },
      messages: [{ $ref: '#/channels/postCreated/messages/PostCreatedEvent' }],
    },
  },
  components: {
    messages: {
      PostCreatedEvent: {
        name: 'PostCreatedEvent',
        payload: { $ref: '#/components/schemas/PostCreatedEvent' },
      },
    },
    schemas: {
      PostCreatedEvent: {
        type: 'object',
        properties: {
          event_id: { type: 'string' },
          post_id: { type: 'string' },
          community_id: { type: 'string' },
        },
        required: ['event_id', 'post_id', 'community_id'],
        additionalProperties: false,
      },
    },
  },
}

const breakingDoc = {
  ...baseDoc,
  info: { title: 'fixture', version: '2.0.0' },
  components: {
    messages: baseDoc.components.messages,
    schemas: {
      PostCreatedEvent: {
        type: 'object',
        properties: { event_id: { type: 'string' }, post_id: { type: 'integer' } },
        required: ['event_id', 'post_id'],
        additionalProperties: false,
      },
    },
  },
}

describe('asyncapiBreakingChanges runs the detector and the classifier together', () => {
  it('reports no breaking changes between identical documents', () => {
    expect(asyncapiBreakingChanges(baseDoc, baseDoc)).toEqual([])
  })

  it('catches a removed payload field and a retyped field that @asyncapi/diff left unclassified', () => {
    const found = asyncapiBreakingChanges(baseDoc, breakingDoc)
    expect(found.length).toBeGreaterThan(0)
    expect(found.some((change) => change.path.endsWith('/properties/community_id'))).toBe(true)
    expect(found.some((change) => change.path.endsWith('/properties/post_id/type'))).toBe(true)
  })
})
