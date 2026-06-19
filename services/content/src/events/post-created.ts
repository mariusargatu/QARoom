import {
  POST_CREATED_EVENT,
  POST_CREATED_VERSION,
  PostCreatedEvent,
  postCreated,
} from '@qaroom/contracts'
import type { IdGenerator } from '@qaroom/determinism'
import { outboxPublish } from '@qaroom/messaging'

/** The transaction handle `outboxPublish` expects, taken from its own signature (driver-agnostic). */
type Tx = Parameters<typeof outboxPublish>[0]

export interface PostCreatedFields {
  id: string
  communityId: string
  authorId: string
  title: string
  body: string
  createdAt: Date
}

/**
 * Build the `PostCreatedEvent` and stage it on the transactional outbox (Commitment 17): the event
 * row commits atomically with the post, and the relay drains it to JetStream with `event_id` as the
 * `Nats-Msg-Id`. Validated through the Zod schema so the wire shape cannot drift from the contract.
 */
export async function publishPostCreated(
  tx: Tx,
  ids: IdGenerator,
  post: PostCreatedFields,
): Promise<void> {
  const event = PostCreatedEvent.parse({
    event_id: ids.next('evt'),
    post_id: post.id,
    community_id: post.communityId,
    author_id: post.authorId,
    title: post.title,
    body: post.body,
    created_at: post.createdAt.toISOString(),
  })
  await outboxPublish(
    tx,
    {
      eventId: event.event_id,
      subject: postCreated(event.community_id),
      eventName: POST_CREATED_EVENT,
      eventVersion: POST_CREATED_VERSION,
      communityId: event.community_id,
      payload: event,
    },
    post.createdAt,
  )
}
