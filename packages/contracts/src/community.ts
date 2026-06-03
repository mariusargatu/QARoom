import { z } from 'zod'
import { CommunityId, UserId } from './ids'
import { AsOf } from './lamport'

// Mirrors the post.ts NUL-byte stance: encode "no NUL" as a regex so the constraint
// lands in the OpenAPI `pattern` and rejects un-storable input as a clean 400.
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting the NUL byte is the whole point.
const NO_NUL = /^[^\x00]*$/
/** A community slug is a short, human-readable, URL-safe handle (the 'general' default). */
const slugField = () =>
  z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9_]+$/, 'must be lowercase alphanumeric + underscore')
const nameField = () => z.string().min(1).max(120).regex(NO_NUL, 'must not contain a NUL byte')

/** A membership role within a community (Commitment 9). */
export const Role = z
  .enum(['owner', 'moderator', 'member'])
  .meta({ id: 'Role', description: 'Membership role within a community.' })
export type Role = z.infer<typeof Role>

/** A community is the tenant (Commitment 9). `community_id` discriminates all tenant data. */
export const Community = z
  .object({
    id: CommunityId,
    slug: slugField(),
    name: nameField(),
    created_at: z.iso.datetime(),
  })
  .meta({ id: 'Community', description: 'A community (tenant) in the identity registry.' })
export type Community = z.infer<typeof Community>

/** A user↔community↔role grant. The set of these a user holds becomes the JWT `memberships` claim. */
export const Membership = z
  .object({
    user_id: UserId,
    community_id: CommunityId,
    role: Role,
    joined_at: z.iso.datetime(),
  })
  .meta({ id: 'Membership', description: 'A user↔community↔role grant.' })
export type Membership = z.infer<typeof Membership>

/** Request body for createCommunity. `.strictObject` rejects unexpected fields. */
export const CreateCommunityRequest = z
  .strictObject({ slug: slugField(), name: nameField() })
  .meta({ id: 'CreateCommunityRequest', description: 'Body for createCommunity.' })
export type CreateCommunityRequest = z.infer<typeof CreateCommunityRequest>

/** Request body for addMembership. The community comes from the path. */
export const AddMembershipRequest = z
  .strictObject({ user_id: UserId, role: Role })
  .meta({ id: 'AddMembershipRequest', description: 'Body for addMembership.' })
export type AddMembershipRequest = z.infer<typeof AddMembershipRequest>

/** A community's members, with a read consistency envelope (mirrors Feed). */
export const MemberList = z
  .object({
    community_id: CommunityId,
    members: z.array(Membership),
    as_of: AsOf,
  })
  .meta({ id: 'MemberList', description: 'Members of a community with a read envelope.' })
export type MemberList = z.infer<typeof MemberList>
