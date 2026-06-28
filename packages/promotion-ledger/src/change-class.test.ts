import { describe, expect, it } from 'vitest'
import { type ChangeClass, classifyChange, isAutoRevertable } from './change-class'

/**
 * The state-aware change classifier (T24 / ADR-0037): only pure-code red is auto-revertable; every
 * event-sourced class freezes green_head + pages. One fixture per class, driven off REAL repo paths,
 * plus the precedence + test-file-exemption cases.
 */
const cases: ReadonlyArray<{ name: string; files: string[]; cls: ChangeClass }> = [
  {
    name: 'a versioned event bump is a breaking-event',
    files: ['packages/contracts/src/events/moderation-decision-recorded.v2.ts'],
    cls: 'breaking-event',
  },
  {
    name: 'a schema migration module is a migration',
    files: ['packages/messaging/src/migrations.ts'],
    cls: 'migration',
  },
  {
    name: 'an XState machine is a state change',
    files: ['packages/contracts/src/machines/erasure.machine.ts'],
    cls: 'state',
  },
  {
    name: 'a TLA+ spec is a state change',
    files: ['spec/tla/Outbox.tla'],
    cls: 'state',
  },
  {
    name: 'the subject grammar is a contract change',
    files: ['packages/contracts/src/subjects.ts'],
    cls: 'contract',
  },
  {
    name: 'a generated OpenAPI doc is a contract change',
    files: ['services/content/openapi.yaml'],
    cls: 'contract',
  },
  {
    name: 'a plain service handler is pure-code',
    files: ['services/content/src/routes/cast-vote.ts'],
    cls: 'pure-code',
  },
]

describe('classifyChange', () => {
  for (const { name, files, cls } of cases) {
    it(name, () => {
      expect(classifyChange(files).class).toBe(cls)
    })
  }

  it('only pure-code is auto-revertable; every stateful class freezes + pages', () => {
    expect(isAutoRevertable(['services/content/src/routes/cast-vote.ts'])).toBe(true)
    expect(isAutoRevertable(['packages/messaging/src/migrations.ts'])).toBe(false)
    expect(classifyChange(['spec/tla/Outbox.tla']).policy).toBe('freeze-and-page')
  })

  it('takes the most-irreversible class when a diff spans several', () => {
    const mixed = classifyChange([
      'services/content/src/routes/cast-vote.ts',
      'packages/contracts/src/subjects.ts',
      'packages/messaging/src/migrations.ts',
      'packages/contracts/src/events/moderation-decision-recorded.v2.ts',
    ])
    expect(mixed.class).toBe('breaking-event')
    expect(mixed.signals).toEqual([
      'packages/contracts/src/events/moderation-decision-recorded.v2.ts',
    ])
  })

  it('a test-only edit of a stateful file stays pure-code (a test carries no forward side effect)', () => {
    expect(classifyChange(['packages/messaging/src/migrations.test.ts']).class).toBe('pure-code')
  })

  it('a v1 event is not a breaking bump', () => {
    expect(classifyChange(['packages/contracts/src/events/post-created.v1.ts']).class).toBe(
      'contract',
    )
  })
})
