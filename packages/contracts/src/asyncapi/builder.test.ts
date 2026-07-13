import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
// Register the event payload schema the channel references.
import '../events/post-created'
import { type AsyncChannel, buildAsyncApiDocument, stringifyAsyncApi } from './builder'

const postCreated: AsyncChannel = {
  id: 'postCreated',
  address: 'qaroom.content.posts.{community_id}.created',
  operationId: 'publishPostCreated',
  action: 'send',
  messageName: 'PostCreatedEvent',
  summary: 'Post created',
  description: 'Emitted when a post is created.',
}

describe('buildAsyncApiDocument', () => {
  it('emits a 3.0.0 document with info, channels, operations, and components', () => {
    const doc = buildAsyncApiDocument({ title: 'content', version: '1.0.0' }, [postCreated])
    expect(doc.asyncapi).toBe('3.0.0')
    expect(doc.channels).toBeDefined()
    expect(doc.operations).toBeDefined()
  })

  it('declares community_id as the channel parameter at the fixed third position', () => {
    const doc = buildAsyncApiDocument({ title: 'content', version: '1.0.0' }, [postCreated])
    const channels = doc.channels as { postCreated: Record<string, unknown> }
    const params = channels.postCreated.parameters as Record<string, unknown>
    expect(params.community_id).toBeDefined()
    expect(channels.postCreated.address).toBe('qaroom.content.posts.{community_id}.created')
  })

  it('wires the operation action and channel reference', () => {
    const doc = buildAsyncApiDocument({ title: 'content', version: '1.0.0' }, [postCreated])
    const ops = doc.operations as { publishPostCreated: Record<string, unknown> }
    expect(ops.publishPostCreated.action).toBe('send')
    expect(ops.publishPostCreated.channel).toEqual({ $ref: '#/channels/postCreated' })
  })

  it('points the message payload at the registry-generated schema ref', () => {
    const doc = buildAsyncApiDocument({ title: 'content', version: '1.0.0' }, [postCreated])
    const components = doc.components as { messages: { PostCreatedEvent: Record<string, unknown> } }
    expect(components.messages.PostCreatedEvent.payload).toEqual({
      $ref: '#/components/schemas/PostCreatedEvent',
    })
  })

  it('includes the reachable payload schema in components', () => {
    const doc = buildAsyncApiDocument({ title: 'content', version: '1.0.0' }, [postCreated])
    const components = doc.components as { schemas: Record<string, unknown> }
    expect(components.schemas.PostCreatedEvent).toMatchObject({ type: 'object' })
  })

  it('emits a servers block keyed by name only when servers are supplied', () => {
    const withServer = buildAsyncApiDocument(
      { title: 'content', version: '1.0.0' },
      [postCreated],
      [{ name: 'nats', host: 'nats:4222', protocol: 'nats', description: 'JetStream' }],
    )
    const withoutServer = buildAsyncApiDocument({ title: 'content', version: '1.0.0' }, [
      postCreated,
    ])
    const servers = withServer.servers as { nats: Record<string, unknown> }
    expect(servers.nats.host).toBe('nats:4222')
    expect(withoutServer.servers).toBeUndefined()
  })

  it('omits an optional info description when not provided', () => {
    const doc = buildAsyncApiDocument({ title: 'content', version: '1.0.0' }, [postCreated])
    expect((doc.info as Record<string, unknown>).description).toBeUndefined()
  })
})

describe('stringifyAsyncApi', () => {
  it('round-trips a built document through deterministic YAML', () => {
    const doc = buildAsyncApiDocument({ title: 'content', version: '1.0.0' }, [postCreated])
    expect(parse(stringifyAsyncApi(doc)).asyncapi).toBe('3.0.0')
  })
})
