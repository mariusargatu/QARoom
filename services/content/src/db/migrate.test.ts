import { assertMigrationDiscipline } from '@qaroom/testing-utils/harness'
import { contentMigrations } from './migrate'

/**
 * Migration discipline (docs/05): up / down / up→down→up→up, NO snapshots — authored once in the
 * shared registrar. Beyond the old name-only check, this asserts the feed's invariant-bearing index
 * exists after up and is dropped with its table. The composed messaging substrate
 * (idempotency_responses/outbox/processed_events) is the registrar's default.
 */
assertMigrationDiscipline({
  name: 'content',
  migrations: contentMigrations,
  domainTables: ['posts', 'votes'],
  indexes: ['posts_community_created_idx'],
})
