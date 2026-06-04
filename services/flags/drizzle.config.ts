import type { Config } from 'drizzle-kit'

/**
 * drizzle-kit config for future generated migrations. Milestone 5 applies schema
 * programmatically via `src/db/migrate.ts`; this exists so `drizzle-kit generate` is ready
 * when deployment shape matters.
 */
export default {
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
} satisfies Config
