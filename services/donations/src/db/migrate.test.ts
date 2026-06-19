import { assertMigrationDiscipline } from '@qaroom/testing-utils/harness'
import { donationsMigrations } from './migrate'

/**
 * Migration discipline (docs/05): up / down / up→down→up→up, NO snapshots — via the shared registrar.
 * Asserts the donations feed index exists after up and is dropped with its table (the old test only
 * checked table names). Messaging substrate is the registrar's default.
 */
assertMigrationDiscipline({
  name: 'donations',
  migrations: donationsMigrations,
  domainTables: ['donations', 'flag_cache'],
  indexes: ['donations_community_created_idx'],
})
