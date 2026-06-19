import { sql } from 'drizzle-orm'
import { assertMigrationDiscipline, type ReversibleMigration } from './migration-discipline'
import type { MigrationTarget } from './setup-service-test'

/**
 * Self-test of the shared registrar: a toy reversible migration (two tables + one index, no messaging
 * substrate) driven through assertMigrationDiscipline. The registered up/down/idempotency/index cases
 * run as real tests in this file — green here proves the helper exercises every step correctly.
 */
const toy: ReversibleMigration<MigrationTarget> = {
  async up(db) {
    await db.execute(sql.raw('CREATE TABLE IF NOT EXISTS widgets (id text PRIMARY KEY)'))
    await db.execute(sql.raw('CREATE TABLE IF NOT EXISTS gadgets (id text PRIMARY KEY)'))
    await db.execute(sql.raw('CREATE INDEX IF NOT EXISTS widgets_kind_idx ON widgets (id)'))
  },
  async down(db) {
    await db.execute(sql.raw('DROP TABLE IF EXISTS widgets'))
    await db.execute(sql.raw('DROP TABLE IF EXISTS gadgets'))
  },
}

assertMigrationDiscipline<MigrationTarget>({
  name: 'toy (self-test)',
  migrations: toy,
  domainTables: ['widgets', 'gadgets'],
  messagingTables: [],
  indexes: ['widgets_kind_idx'],
})
