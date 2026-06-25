import { z } from 'zod'
import { UserId } from './ids'
import { NO_NUL } from './no-nul'

/** A handle is a unique, URL-safe login name. */
const handleField = () =>
  z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'must be lowercase alphanumeric + underscore')
const displayField = () => z.string().min(1).max(120).regex(NO_NUL, 'must not contain a NUL byte')

/** A user identity. Authentication credentials are out of scope for Milestone 2 (issuance is the tested surface). */
export const User = z
  .object({
    id: UserId,
    handle: handleField(),
    display_name: displayField(),
    created_at: z.iso.datetime(),
  })
  .meta({ id: 'User', description: 'A user identity.' })
export type User = z.infer<typeof User>

/** Request body for createUser. `.strictObject` rejects unexpected fields. */
export const CreateUserRequest = z
  .strictObject({ handle: handleField(), display_name: displayField() })
  .meta({ id: 'CreateUserRequest', description: 'Body for createUser.' })
export type CreateUserRequest = z.infer<typeof CreateUserRequest>
