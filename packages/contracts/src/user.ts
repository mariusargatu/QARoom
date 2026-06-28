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

/**
 * The 202 body of `DELETE /api/users/{id}` (the GDPR erasure saga, ADR-0036). Erasure is
 * orchestrated as a state machine and cascades asynchronously, so the endpoint ACCEPTS the request:
 * it has already deleted identity-local data and staged one `user.erased` event per community the
 * user belonged to (`communities`). Downstream services consume those and delete their slice; the
 * saga reaches `Erased` once every participant has confirmed. The `saga_id` is the erasure's handle.
 */
export const UserErasureAccepted = z
  .object({
    saga_id: z.string(),
    user_id: UserId,
    /** Saga state at the moment the request was accepted — always the post-Start `Cascading`. */
    status: z.literal('Cascading'),
    /** The communities a `user.erased` event was staged for (the per-tenant cascade fan-out). */
    communities: z.array(z.string()),
  })
  .meta({ id: 'UserErasureAccepted', description: 'Acknowledges an accepted user-erasure saga.' })
export type UserErasureAccepted = z.infer<typeof UserErasureAccepted>
