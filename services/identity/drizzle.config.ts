import type { Config } from 'drizzle-kit'

/**
 * drizzle-kit config for future generated migrations. Milestone 2 applies schema through
 * the migration state machine (`src/db/migrate.ts`); this exists so `drizzle-kit generate`
 * is ready when deployment shape matters (Milestone 3).
 */
export default {
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
} satisfies Config
