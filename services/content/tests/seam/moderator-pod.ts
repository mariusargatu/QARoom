import { PostCreatedEvent, postsCreatedAnyCommunity, subjectMatchesFilter } from '@qaroom/contracts'
import type { PublishedMessage } from '@qaroom/testing-utils/scenario'

/** The cross-tenant `posts.created` wildcard the real moderator binds its durable consumer to. */
const MODERATOR_SUBJECT_FILTER = postsCreatedAnyCommunity()

export interface ModerationOutcome {
  postId: string
  communityId: string
}

export interface ModeratorPod {
  readonly decisions: ReadonlyArray<ModerationOutcome>
  bringUp(): void
  consume(stream: readonly PublishedMessage[]): void
}

/**
 * A double for the moderator-agent's durable NATS consumer — the async, downstream half of the
 * content→moderator pipe (ADR-0018: the moderator PROPOSES from `post.created` events; it never sits
 * on the create path). It knows only the moderator's REAL binding: the cross-tenant `posts.created`
 * wildcard and the `PostCreatedEvent` contract it decodes (the same authority the shared-broker seam
 * test uses), so a routing or wire-shape drift would surface here too.
 *
 * Lifecycle mirrors a Kubernetes pod. `up: false` is a DOWN pod: its durable pulls nothing from the
 * stream JetStream retains for it, so `consume()` records no decisions. `bringUp()` recovers it, and
 * `consume()` then drains the retained backlog (at-least-once). Decisions dedupe on post id, so a
 * re-delivery never double-records — the receiver-dedup discipline the real consumer keeps.
 */
export function moderatorPod(opts: { up: boolean }): ModeratorPod {
  let up = opts.up
  const seen = new Set<string>()
  const decisions: ModerationOutcome[] = []
  return {
    get decisions() {
      return decisions
    },
    bringUp() {
      up = true
    },
    consume(stream) {
      if (!up) return
      for (const message of stream) {
        if (!subjectMatchesFilter(MODERATOR_SUBJECT_FILTER, message.subject)) continue
        const event = PostCreatedEvent.parse(message.payload)
        if (seen.has(event.post_id)) continue
        seen.add(event.post_id)
        decisions.push({ postId: event.post_id, communityId: event.community_id })
      }
    },
  }
}
