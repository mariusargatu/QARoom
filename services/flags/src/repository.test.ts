import {
  FLAG_STATE_CHANGED_EVENT,
  flagStateChanged,
  LamportGate,
  type RolloutEventName,
  type RolloutTransitionRecord,
} from '@qaroom/contracts'
import { pgliteRows, type RepoTest, setupRepoTest } from '@qaroom/testing-utils/harness'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FlagsDb } from './db/client'
import { ensureSchema } from './db/migrate'
import type { RepoDeps } from './deps'
import { advanceRollout, countFlags, listFlags, resolveFlag } from './repository'

/**
 * flags-service repository: the rollout machine is the project's core demonstration, but its
 * persistence side (absent-row default, the changed:false short-circuit, the post-commit outbox +
 * lamport + transition-sink trio, and the deliberate canary-misroute TRANSFER bug) had no unit
 * test. The machine decides legality; these pin what the repository does AROUND that decision.
 */
const COMMUNITY = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD'
const OTHER = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CE'
const FLAG = 'donations'

interface OutboxRow {
  subject: string
  event_name: string
  payload: Record<string, unknown>
}

let ctx: RepoTest<FlagsDb>
let deps: RepoDeps
let records: RolloutTransitionRecord[]

const outboxRows = () =>
  pgliteRows<OutboxRow>(ctx.db, sql`SELECT subject, event_name, payload FROM outbox`)

const advance = (event: RolloutEventName, flag = FLAG) =>
  advanceRollout(ctx.db, deps, COMMUNITY, flag, event)

/** Drive a flag through the happy rollout path to `Enabled`. */
const enableFully = async () => {
  await advance('EnableRequested')
  await advance('CanaryConfirmed')
  await advance('RolloutCompleted')
}

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

describe('repository/resolveFlag', () => {
  it('returns the initial Off state (disabled) for a flag with no row', async () => {
    expect(await resolveFlag(ctx.db, COMMUNITY, FLAG)).toEqual({
      community_id: COMMUNITY,
      flag_key: FLAG,
      state: 'Off',
      enabled: false,
    })
  })

  it('reports enabled only once the rollout reaches Enabled, not at Canary', async () => {
    await advance('EnableRequested')
    await advance('CanaryConfirmed')
    expect((await resolveFlag(ctx.db, COMMUNITY, FLAG)).enabled).toBe(false)

    await advance('RolloutCompleted')
    expect(await resolveFlag(ctx.db, COMMUNITY, FLAG)).toEqual({
      community_id: COMMUNITY,
      flag_key: FLAG,
      state: 'Enabled',
      enabled: true,
    })
  })
})

describe('repository/advanceRollout legal transition', () => {
  it('persists the new state and stages exactly one FlagStateChanged outbox event', async () => {
    const res = await advance('EnableRequested')

    expect(res).toEqual({ changed: true, from: 'Off', to: 'Enabling' })
    const rows = await outboxRows()
    expect(rows.length).toBe(1)
    expect(rows[0]?.subject).toBe(flagStateChanged(COMMUNITY))
    expect(rows[0]?.event_name).toBe(FLAG_STATE_CHANGED_EVENT)
    expect(rows[0]?.payload.to_state).toBe('Enabling')
    expect((await resolveFlag(ctx.db, COMMUNITY, FLAG)).state).toBe('Enabling')
  })

  it('bumps the lamport gate and records the transition to its sink after commit', async () => {
    await advance('EnableRequested')

    expect(deps.lamport.value).toBe(1)
    expect(records.length).toBe(1)
    expect(records[0]).toMatchObject({ from: 'Off', to: 'Enabling', event: 'EnableRequested' })
  })
})

describe('repository/advanceRollout illegal transition', () => {
  it('leaves state untouched and emits nothing when the event is illegal from the current state', async () => {
    const res = await advance('RolloutCompleted') // illegal from Off

    expect(res).toEqual({ changed: false, from: 'Off', to: 'Off' })
    expect((await outboxRows()).length).toBe(0)
    expect(deps.lamport.value).toBe(0)
    expect(records.length).toBe(0)
    expect((await resolveFlag(ctx.db, COMMUNITY, FLAG)).state).toBe('Off')
  })
})

describe('repository/listFlags + countFlags', () => {
  it('counts zero on an empty store and one after a single flag advances', async () => {
    expect(await countFlags(ctx.db)).toBe(0)
    await advance('EnableRequested')
    expect(await countFlags(ctx.db)).toBe(1)
  })

  it('lists a community’s flags key-ordered, mapping each to its enabled projection', async () => {
    await enableFully() // donations → Enabled
    await advance('EnableRequested', 'beta') // beta → Enabling

    const list = await listFlags(ctx.db, COMMUNITY)

    expect(list.map((f) => f.flag_key)).toEqual(['beta', 'donations'])
    expect(list.find((f) => f.flag_key === 'donations')?.enabled).toBe(true)
    expect(list.find((f) => f.flag_key === 'beta')?.enabled).toBe(false)
  })

  it('scopes listFlags to one community', async () => {
    await advance('EnableRequested')
    await advanceRollout(ctx.db, deps, OTHER, FLAG, 'EnableRequested')

    const list = await listFlags(ctx.db, COMMUNITY)
    expect(list.length).toBe(1)
  })
})

describe('repository/advanceRollout canary-misroute deliberate bug (FLAGS_BUG_CANARY_MISROUTES)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('routes a confirmed canary to Canary when the toggle is off (the correct transition)', async () => {
    await advance('EnableRequested')
    const res = await advance('CanaryConfirmed')

    expect(res.to).toBe('Canary')
    expect((await resolveFlag(ctx.db, COMMUNITY, FLAG)).state).toBe('Canary')
  })

  it('misroutes a confirmed canary straight to Enabled when the toggle is on — every observable agrees', async () => {
    vi.stubEnv('FLAGS_BUG_CANARY_MISROUTES', '1')
    await advance('EnableRequested')
    const res = await advance('CanaryConfirmed')

    expect(res.to).toBe('Enabled')
    expect((await resolveFlag(ctx.db, COMMUNITY, FLAG)).state).toBe('Enabled')
    expect(records.at(-1)?.to).toBe('Enabled')
    const rows = await outboxRows()
    expect(rows.at(-1)?.payload.to_state).toBe('Enabled')
  })

  it('stays inert in production even with the toggle on (the NODE_ENV gate)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('FLAGS_BUG_CANARY_MISROUTES', '1')
    await advance('EnableRequested')
    const res = await advance('CanaryConfirmed')

    expect(res.to).toBe('Canary')
  })
})
