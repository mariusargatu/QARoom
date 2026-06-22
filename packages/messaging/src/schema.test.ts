import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { idempotencyResponses } from './schema'

describe('idempotencyResponses is the shared Drizzle model of the replay store', () => {
  it('maps to the idempotency_responses table', () => {
    expect(getTableConfig(idempotencyResponses).name).toBe('idempotency_responses')
  })

  it('declares the shared column set', () => {
    const columns = getTableConfig(idempotencyResponses)
      .columns.map((c) => c.name)
      .sort()
    expect(columns).toEqual([
      'body_hash',
      'created_at',
      'idempotency_key',
      'response_body',
      'route',
      'status',
    ])
  })

  it('uses (idempotency_key, route, body_hash) as the composite primary key', () => {
    const pk = getTableConfig(idempotencyResponses).primaryKeys[0]
    expect(pk?.columns.map((c) => c.name)).toEqual(['idempotency_key', 'route', 'body_hash'])
  })
})
