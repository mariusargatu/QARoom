import { LamportGate, type RolloutTransitionRecord } from '@qaroom/contracts'
import { type RepoTest, setupRepoTest } from '@qaroom/testing-utils/harness'
import { failingDb, InjectedDbError } from '@qaroom/testing-utils/scenario'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FlagsDb } from '../src/db/client'
import { ensureSchema } from '../src/db/migrate'
import type { RepoDeps } from '../src/deps'
import { advanceRollout, resolveFlag } from '../src/repository'

/**
 * flags-service scenario catalog (UNIT-L1-PLAN.md §7). `advanceRollout` bumps the LamportGate and
 * records the transition to its sink ONLY after the db transaction commits — the deliberate
 * structure (the trio lives outside `db.transaction`) that keeps an observed transition reflecting
 * committed state. PGlite never errors, so a failed-commit path was unreachable; `failingDb` injects
 * a write failure inside the rollout transaction and pins that the post-commit side effects DO NOT
 * fire — the rollback invariant the adversarial review found unpinned.
 */
const COMMUNITY = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD'
const FLAG = 'donations'

let ctx: RepoTest<FlagsDb>
let records: RolloutTransitionRecord[]
let lamport: LamportGate
let deps: RepoDeps

beforeEach(async () => {
  ctx = await setupRepoTest<FlagsDb>({ applyMigrations: (db) => ensureSchema(db) })
  records = []
  lamport = new LamportGate(ctx.ids)
  deps = {
    clock: ctx.clock,
    ids: ctx.ids,
    lamport,
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

describe('flags scenario: a DB failure inside the rollout transaction', () => {
  it('rolls back with no lamport bump, no transition record, and no persisted state change', async () => {
    const fdb = failingDb(ctx.db, { op: 'insert', table: 'flags' })

    await expect(
      advanceRollout(fdb, deps, COMMUNITY, FLAG, 'EnableRequested'),
    ).rejects.toBeInstanceOf(InjectedDbError)

    // The bump + sink record run AFTER the transaction commits; a failed tx must leave them untouched.
    expect(lamport.value).toBe(0)
    expect(records.length).toBe(0)
    // No partial state — read against the clean db, the flag is still its initial Off.
    expect((await resolveFlag(ctx.db, COMMUNITY, FLAG)).state).toBe('Off')
  })

  it('isolates the fault to the wrapped handle: a subsequent clean advance commits normally', async () => {
    const ok = await advanceRollout(ctx.db, deps, COMMUNITY, FLAG, 'EnableRequested')

    expect(ok).toEqual({ changed: true, from: 'Off', to: 'Enabling' })
    expect(lamport.value).toBe(1)
    expect(records.length).toBe(1)
  })
})
