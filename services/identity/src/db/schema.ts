import { integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import type { JWK } from 'jose'

/**
 * identity-service persistence (Milestone 2). Communities are tenants (Commitment 9);
 * `community_id` discriminates all tenant data. Branded IDs are stored as their
 * prefixed-ULID text form. Signing keys are stored as JWKs so the JWKS endpoint and
 * rotation are pure data operations (ADR-0008).
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  handle: text('handle').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

export const communities = pgTable('communities', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

export const memberships = pgTable(
  'memberships',
  {
    userId: text('user_id').notNull(),
    communityId: text('community_id').notNull(),
    role: text('role').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.communityId] })],
)

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  kid: text('kid').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

/** ES256 signing keys. `status` is 'current' | 'previous' | 'retired'; a partial unique index keeps one 'current'. */
export const signingKeys = pgTable('signing_keys', {
  kid: text('kid').primaryKey(),
  alg: text('alg').notNull(),
  publicJwk: jsonb('public_jwk').$type<JWK>().notNull(),
  privateJwk: jsonb('private_jwk').$type<JWK>().notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
})

/** Idempotency-Key replay store (Commitment 4), keyed by (key, route, body_hash). */
export const idempotencyResponses = pgTable(
  'idempotency_responses',
  {
    idempotencyKey: text('idempotency_key').notNull(),
    route: text('route').notNull(),
    bodyHash: text('body_hash').notNull(),
    status: integer('status').notNull(),
    responseBody: jsonb('response_body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.idempotencyKey, t.route, t.bodyHash] })],
)

export const schema = {
  users,
  communities,
  memberships,
  sessions,
  signingKeys,
  idempotencyResponses,
}
