import { z } from 'zod'
import { CommunityId, PostId, UserId } from './ids'
import { AsOf } from './lamport'

// Postgres `text` cannot store a NUL byte. Encoding "no NUL" as a regex makes the
// constraint part of the OpenAPI `pattern` (so fuzzers don't generate NUL strings and
// the schema agrees with the API) and rejects un-storable input as a clean 400. The
// pattern is written with the `\x00` escape — text, never a literal NUL byte.
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting the NUL byte is the whole point.
const NO_NUL = /^[^\x00]*$/
const titleField = () => z.string().min(1).max(300).regex(NO_NUL, 'must not contain a NUL byte')
const bodyField = () => z.string().max(40_000).regex(NO_NUL, 'must not contain a NUL byte')

/** A post within a community. `score` is the aggregated vote sum. */
export const Post = z
  .object({
    id: PostId,
    community_id: CommunityId,
    author_id: UserId,
    title: titleField(),
    body: bodyField(),
    score: z.number().int(),
    created_at: z.iso.datetime(),
  })
  .meta({ id: 'Post', description: 'A post within a community.' })
export type Post = z.infer<typeof Post>

/** Request body for createPost. `.strict()` rejects unexpected fields (matches OAS additionalProperties:false). */
export const CreatePostRequest = z
  .strictObject({
    author_id: UserId,
    title: titleField(),
    body: bodyField(),
  })
  .meta({ id: 'CreatePostRequest', description: 'Body for createPost.' })
export type CreatePostRequest = z.infer<typeof CreatePostRequest>

/** A page of community posts, newest first, with a read envelope. */
export const Feed = z
  .object({
    community_id: CommunityId,
    posts: z.array(Post),
    as_of: AsOf,
  })
  .meta({ id: 'Feed', description: 'A community feed page with a read envelope.' })
export type Feed = z.infer<typeof Feed>
