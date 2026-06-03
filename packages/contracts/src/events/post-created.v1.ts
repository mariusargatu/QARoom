import { z } from 'zod'
import { CommunityId, EventId, PostId, UserId } from '../ids'

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting the NUL byte is the whole point.
const NO_NUL = /^[^\x00]*$/

/**
 * FROZEN v1 shape of `PostCreatedEvent` (Milestone 4). Once a breaking change lands on the
 * live schema, this file stays byte-stable as the record of what a v1 consumer expects.
 * The compat test (`events.compat.test.ts`) asserts the current producer's output still
 * parses here — the forward-compatibility guarantee (conventions §2). Deliberately NOT
 * registered in the Zod global registry (no `.meta({ id })`) so it never leaks into the
 * generated AsyncAPI document.
 */
export const PostCreatedEventV1 = z.object({
  event_id: EventId,
  post_id: PostId,
  community_id: CommunityId,
  author_id: UserId,
  title: z.string().min(1).max(300).regex(NO_NUL, 'must not contain a NUL byte'),
  body: z.string().max(40_000).regex(NO_NUL, 'must not contain a NUL byte'),
  created_at: z.iso.datetime(),
})
export type PostCreatedEventV1 = z.infer<typeof PostCreatedEventV1>
