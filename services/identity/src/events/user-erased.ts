import {
  USER_ERASED_EVENT,
  USER_ERASED_VERSION,
  UserErasedEvent,
  userErased,
} from '@qaroom/contracts'
import type { IdGenerator } from '@qaroom/determinism'
import { outboxPublish } from '@qaroom/messaging'

/** The transaction handle `outboxPublish` expects, taken from its own signature (driver-agnostic). */
type Tx = Parameters<typeof outboxPublish>[0]

export interface UserErasedFields {
  userId: string
  communityId: string
  requestedAt: Date
}

/**
 * Build the `UserErasedEvent` and stage it on the transactional outbox (Commitment 17): the event row
 * commits atomically with the user delete, and the relay drains it to JetStream with `event_id` as the
 * `Nats-Msg-Id`. Validated through the Zod schema so the wire shape cannot drift from the contract.
 * Identity emits one of these per community the user belonged to — the per-tenant cascade fan-out.
 */
export async function publishUserErased(
  tx: Tx,
  ids: IdGenerator,
  fields: UserErasedFields,
): Promise<void> {
  const event = UserErasedEvent.parse({
    event_id: ids.next('evt'),
    user_id: fields.userId,
    community_id: fields.communityId,
    requested_at: fields.requestedAt.toISOString(),
  })
  await outboxPublish(
    tx,
    {
      eventId: event.event_id,
      subject: userErased(event.community_id),
      eventName: USER_ERASED_EVENT,
      eventVersion: USER_ERASED_VERSION,
      communityId: event.community_id,
      payload: event,
    },
    fields.requestedAt,
  )
}
