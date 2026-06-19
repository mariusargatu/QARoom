import { assertMigrationDiscipline } from '@qaroom/testing-utils/harness'
import { flagsMigrations } from './migrate'

/**
 * Migration discipline (docs/05): up / down / up→down→up→up, NO snapshots — via the shared registrar.
 * Asserts the (community_id, flag_key) composite primary-key index — the tenancy + advisory-lock
 * contract — exists after up and is dropped with its table (the old test checked table names only).
 */
assertMigrationDiscipline({
  name: 'flags',
  migrations: flagsMigrations,
  domainTables: ['flags'],
  indexes: ['flags_pkey'],
})
