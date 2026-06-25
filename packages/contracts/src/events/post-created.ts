import { z } from 'zod'
import { CommunityId, EventId, PostId, UserId } from '../ids'
import { NO_NUL } from '../no-nul'

/**
 * Emitted when a post is created — subject `qaroom.content.posts.<community_id>.created`.
 *
 * Lean but self-sufficient: a consumer acts without calling back to content-service.
 * `event_id` is the `IdGenerator`'s `evt_<ulid>`; it doubles as the `Nats-Msg-Id` and the
 * consumer `processed_events` key. Defined as a non-strict object on purpose: an additive
 * optional field stays forward-compatible for an older consumer (conventions §2). A
 * breaking change freezes the prior shape as `post-created.v1.ts`.
 */
export const PostCreatedEvent = z
  .object({
    event_id: EventId,
    post_id: PostId,
    community_id: CommunityId,
    author_id: UserId,
    title: z.string().min(1).max(300).regex(NO_NUL, 'must not contain a NUL byte'),
    body: z.string().max(40_000).regex(NO_NUL, 'must not contain a NUL byte'),
    created_at: z.iso.datetime(),
  })
  .meta({ id: 'PostCreatedEvent', description: 'Emitted when a post is created.' })
export type PostCreatedEvent = z.infer<typeof PostCreatedEvent>

/** Canonical event name — NATS header `event-name` and the AsyncAPI message name. */
export const POST_CREATED_EVENT = 'post.created'
/** Schema version — NATS header `event-version`; bumped only on a breaking change. */
export const POST_CREATED_VERSION = 1
