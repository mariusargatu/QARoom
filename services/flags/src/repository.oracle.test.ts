import {
  LamportGate,
  type RolloutEventName,
  type RolloutState,
  type RolloutTransitionRecord,
  rolloutEnabled,
} from '@qaroom/contracts'
import { pgliteRows, type RepoTest, setupRepoTest } from '@qaroom/testing-utils/harness'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FlagsDb } from './db/client'
import { ensureSchema } from './db/migrate'
import type { RepoDeps } from './deps'
import { advanceRollout, resolveFlag } from './repository'

/**
 * Missing-oracle coverage around the repository's projection/scoping:
 *  - the staged FlagStateChanged payload's `enabled` must be the rollout-machine projection of
 *    the NEW state (`to_state`), derived from the single source `rolloutEnabled`, not the old one.
 *  - resolveFlag must key on (community_id, flag_key): two flags in one community at distinct
 *    states must each resolve to their own state.
 */
const COMMUNITY = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD'
const FLAG = 'donations'

interface OutboxRow {
  payload: { to_state: RolloutState; enabled: boolean }
}

let ctx: RepoTest<FlagsDb>
let deps: RepoDeps
let records: RolloutTransitionRecord[]

const outboxRows = () => pgliteRows<OutboxRow>(ctx.db, sql`SELECT payload FROM outbox`)

const advance = (event: RolloutEventName, flag = FLAG) =>
  advanceRollout(ctx.db, deps, COMMUNITY, flag, event)

beforeEach(async () => {
  ctx = await setupRepoTest<FlagsDb>({ applyMigrations: (db) => ensureSchema(db) })
  records = []
  deps = {
    clock: ctx.clock,
    ids: ctx.ids,
    lamport: new LamportGate(ctx.ids),
    transitionSink: {
      record: (t) => {
        records.push(t)
      },
    },
  }
})

afterEach(async () => {
  await ctx.close()
})

describe('repository/advanceRollout staged-payload enabled projection', () => {
  it('stamps payload.enabled = rolloutEnabled(to_state) at every step of the happy rollout', async () => {
    await advance('EnableRequested') // Off → Enabling
    await advance('CanaryConfirmed') // Enabling → Canary
    await advance('RolloutCompleted') // Canary → Enabled

    const payloads = (await outboxRows()).map((r) => r.payload)
    const byState = (s: RolloutState) => payloads.find((p) => p.to_state === s)
    expect(payloads.map((p) => p.to_state).sort()).toEqual(['Canary', 'Enabled', 'Enabling'])
    // Derive the expected boolean from the single source, per to_state. The bug
    // (enabled from the OLD `from` state) survives every step except Canary → Enabled,
    // where the projection flips false → true.
    expect(byState('Enabling')?.enabled).toBe(rolloutEnabled('Enabling'))
    expect(byState('Canary')?.enabled).toBe(rolloutEnabled('Canary'))
    expect(byState('Enabled')?.enabled).toBe(rolloutEnabled('Enabled'))
  })
})

describe('repository/resolveFlag keys on (community_id, flag_key)', () => {
  it('resolves two flags in one community to their own distinct states', async () => {
    await advance('EnableRequested', 'donations') // donations → Enabling
    await advance('EnableRequested', 'beta')
    await advance('CanaryConfirmed', 'beta') // beta → Canary

    expect((await resolveFlag(ctx.db, COMMUNITY, 'donations')).state).toBe('Enabling')
    expect((await resolveFlag(ctx.db, COMMUNITY, 'beta')).state).toBe('Canary')
  })
})
