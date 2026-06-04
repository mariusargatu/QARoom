import {
  applyRolloutEvent,
  FLAG_STATE_CHANGED_EVENT,
  FLAG_STATE_CHANGED_VERSION,
  FlagStateChangedEvent,
  flagStateChanged,
  type RolloutApplyResult,
  type RolloutEventName,
  type RolloutState,
  rolloutEnabled,
} from '@qaroom/contracts'
import { advisoryLock, outboxPublish } from '@qaroom/messaging'
import { traced } from '@qaroom/otel'
import { eq, sql } from 'drizzle-orm'
import type { FlagsDb } from './db/client'
import { flags } from './db/schema'
import type { RepoDeps } from './deps'

/** snake_case flag record matching the public shape; routes wrap it in `FlagResolution`. */
export interface FlagRecord {
  community_id: string
  flag_key: string
  state: RolloutState
  enabled: boolean
}

/** Result of an advance attempt. `changed: false` means the event was illegal from `from`. */
export interface RolloutOutcome {
  changed: boolean
  from: RolloutState
  to: RolloutState
}

const INITIAL_STATE: RolloutState = 'Off'

function toRecord(communityId: string, flagKey: string, state: RolloutState): FlagRecord {
  return { community_id: communityId, flag_key: flagKey, state, enabled: rolloutEnabled(state) }
}

/** Resolve a flag's current value. Absent row ⇒ the rollout's initial `Off` state. */
export async function resolveFlag(
  db: FlagsDb,
  communityId: string,
  flagKey: string,
): Promise<FlagRecord> {
  const rows = await db
    .select({ state: flags.state })
    .from(flags)
    .where(sql`${flags.communityId} = ${communityId} and ${flags.flagKey} = ${flagKey}`)
    .limit(1)
  const state = (rows[0]?.state as RolloutState | undefined) ?? INITIAL_STATE
  return toRecord(communityId, flagKey, state)
}

/** Every flag resolved for one community (tenant-scoped). */
export async function listFlags(db: FlagsDb, communityId: string): Promise<FlagRecord[]> {
  const rows = await db
    .select({ flagKey: flags.flagKey, state: flags.state })
    .from(flags)
    .where(eq(flags.communityId, communityId))
    .orderBy(flags.flagKey)
  return rows.map((r) => toRecord(communityId, r.flagKey, r.state as RolloutState))
}

/**
 * Advance a flag's rollout by applying one event. The rollout machine — not this code —
 * decides legality (`applyRolloutEvent`); an illegal event leaves the state untouched and
 * returns `changed: false`, which the route maps to a 409. A real transition persists the
 * new state, emits the flag-changed event through the transactional outbox (Commitment 17),
 * bumps the LamportGate, and records the transition as an `xstate.transition` span — but
 * only AFTER the transaction commits, so an observed transition always reflects committed
 * state (the substrate for reverse conformance, ADR-0012).
 */
export async function advanceRollout(
  db: FlagsDb,
  deps: RepoDeps,
  communityId: string,
  flagKey: string,
  event: RolloutEventName,
): Promise<RolloutOutcome> {
  return traced('db.flags.advance', async () => {
    let applied: RolloutApplyResult | undefined
    await db.transaction(async (tx) => {
      await advisoryLock(tx, `${communityId}:${flagKey}`)
      const rows = await tx
        .select({ state: flags.state })
        .from(flags)
        .where(sql`${flags.communityId} = ${communityId} and ${flags.flagKey} = ${flagKey}`)
        .for('update')
        .limit(1)
      const current = (rows[0]?.state as RolloutState | undefined) ?? INITIAL_STATE

      // No sink here: the transition span is emitted after commit, not inside the tx.
      applied = applyRolloutEvent(current, event, { clock: deps.clock })
      if (!applied.changed) return

      const updatedAt = deps.clock.now()
      await tx
        .insert(flags)
        .values({ communityId, flagKey, state: applied.to, updatedAt })
        .onConflictDoUpdate({
          target: [flags.communityId, flags.flagKey],
          set: { state: applied.to, updatedAt },
        })

      const evt = FlagStateChangedEvent.parse({
        event_id: deps.ids.next('evt'),
        community_id: communityId,
        flag_key: flagKey,
        from_state: applied.from,
        to_state: applied.to,
        rollout_event: event,
        enabled: rolloutEnabled(applied.to),
        occurred_at: updatedAt.toISOString(),
      })
      await outboxPublish(
        tx,
        {
          eventId: evt.event_id,
          subject: flagStateChanged(communityId),
          eventName: FLAG_STATE_CHANGED_EVENT,
          eventVersion: FLAG_STATE_CHANGED_VERSION,
          communityId,
          payload: evt,
        },
        updatedAt,
      )
    })

    // applied is always assigned inside the transaction body above.
    const result = applied as RolloutApplyResult
    if (result.changed && result.transition) {
      deps.lamport.bump()
      deps.transitionSink.record(result.transition)
    }
    return { changed: result.changed, from: result.from, to: result.to }
  })
}

export async function countFlags(db: FlagsDb): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)::int` }).from(flags)
  return rows[0]?.n ?? 0
}
