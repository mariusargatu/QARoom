"""Idempotent DDL for the moderator's own Postgres (with pgvector). Applied on boot.

The moderator OWNS this schema (services own their data, Commitment): its decisions, the
per-community rules it judges against, and the pgvector knowledge base of past posts. There is no
``processed_events`` table — *async* dedup is delegated to LangGraph's checkpointer plus the unique
``event_id`` on ``moderation_decisions`` (the deliberate asymmetry vs the TS services, ADR-0018).
HTTP-level idempotency, however, follows the universal convention: ``idempotency_responses`` caches
the response for a given Idempotency-Key so a replayed mutation never re-runs the workflow
(Commitment 4) — the same table shape as ``@qaroom/messaging``.
"""

from __future__ import annotations

from typing import LiteralString

from psycopg_pool import AsyncConnectionPool

_DDL: tuple[LiteralString, ...] = (
    "CREATE EXTENSION IF NOT EXISTS vector",
    """CREATE TABLE IF NOT EXISTS community_rules (
        community_id text NOT NULL,
        rule_id text NOT NULL,
        text text NOT NULL,
        severity text NOT NULL,
        PRIMARY KEY (community_id, rule_id)
    )""",
    # Decisions are citation-bearing as of M12 (ADR-0020): `disposition` (3-valued) replaces v1's
    # `verdict`, and `cited_rules`/`precedents` are jsonb arrays. A FRESH DB gets the canonical shape
    # here; the idempotent ALTERs below migrate an EXISTING table (CREATE … IF NOT EXISTS is a no-op on
    # one that already has the v1 columns — R2). Drops are guarded so the migration is re-runnable.
    """CREATE TABLE IF NOT EXISTS moderation_decisions (
        decision_id text PRIMARY KEY,
        event_id text NOT NULL UNIQUE,
        post_id text NOT NULL,
        community_id text NOT NULL,
        author_id text NOT NULL,
        disposition text NOT NULL,
        cited_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
        precedents jsonb NOT NULL DEFAULT '[]'::jsonb,
        departs_from_precedent boolean NOT NULL DEFAULT false,
        rationale text NOT NULL,
        confidence double precision NOT NULL,
        model text NOT NULL,
        created_at text NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS moderation_decisions_community_idx "
    "ON moderation_decisions (community_id, created_at)",
    # v1→v2 column migration for a pre-existing table (nullable adds so a backfill never fails; drops
    # guarded). Fresh tables already have the canonical NOT NULL shape from the CREATE above.
    "ALTER TABLE moderation_decisions ADD COLUMN IF NOT EXISTS disposition text",
    "ALTER TABLE moderation_decisions ADD COLUMN IF NOT EXISTS cited_rules jsonb DEFAULT '[]'::jsonb",
    "ALTER TABLE moderation_decisions ADD COLUMN IF NOT EXISTS precedents jsonb DEFAULT '[]'::jsonb",
    "ALTER TABLE moderation_decisions "
    "ADD COLUMN IF NOT EXISTS departs_from_precedent boolean DEFAULT false",
    "ALTER TABLE moderation_decisions ADD COLUMN IF NOT EXISTS rationale text",
    # Backfill the new NOT-NULL-on-fresh columns from the v1 data BEFORE dropping it, so a pre-existing
    # M9 row stays readable (a NULL disposition/rationale would fail ModerationDecision.model_validate).
    # Guarded + plpgsql-late-bound: on a fresh table the v1 columns never existed, the IF is false, and
    # the UPDATE referencing them is never planned — a no-op. v1 `flag` had no abstain, so it maps to
    # `remove`; `rule_id` becomes a single-element `cited_rules`.
    """DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'moderation_decisions' AND column_name = 'verdict'
      ) THEN
        UPDATE moderation_decisions SET
          disposition = COALESCE(disposition, CASE verdict WHEN 'allow' THEN 'approve' ELSE 'remove' END),
          rationale = COALESCE(rationale, reason),
          cited_rules = CASE WHEN cited_rules = '[]'::jsonb AND rule_id IS NOT NULL
                             THEN jsonb_build_array(rule_id) ELSE cited_rules END
        WHERE disposition IS NULL OR rationale IS NULL;
      END IF;
    END $$;""",
    "ALTER TABLE moderation_decisions DROP COLUMN IF EXISTS verdict",
    "ALTER TABLE moderation_decisions DROP COLUMN IF EXISTS rule_id",
    "ALTER TABLE moderation_decisions DROP COLUMN IF EXISTS reason",
    # vector(1536) = text-embedding-3-small's dimension (Settings.moderator_embedding_dim), inlined as
    # a literal to keep this LiteralString. Keep the two in sync if the embedding model changes.
    """CREATE TABLE IF NOT EXISTS post_embeddings (
        post_id text PRIMARY KEY,
        community_id text NOT NULL,
        title text NOT NULL,
        body_excerpt text NOT NULL,
        summary text NOT NULL,
        embedding vector(1536),
        created_at text NOT NULL
    )""",
    # Per-community POLICY CORPUS (FR1, ADR-0020): the versioned rules + escalation guidelines +
    # precedent the agent retrieves over. `entry_type ∈ {rule, guideline, precedent}`. Embedded so
    # retrieval is load-bearing; the embedding is nullable (a fresh seed before embeddings are built,
    # or a deterministic test that uses the zero embedder).
    """CREATE TABLE IF NOT EXISTS policy_corpus (
        community_id text NOT NULL,
        version text NOT NULL,
        entry_id text NOT NULL,
        entry_type text NOT NULL,
        text text NOT NULL,
        severity text,
        embedding vector(1536),
        created_at text NOT NULL,
        PRIMARY KEY (community_id, version, entry_id)
    )""",
    "CREATE INDEX IF NOT EXISTS policy_corpus_community_idx "
    "ON policy_corpus (community_id, entry_type)",
    # HTTP idempotency cache (Commitment 4) — same shape as @qaroom/messaging's table. A replayed
    # Idempotency-Key on the same route + body returns response_body without re-running the workflow.
    """CREATE TABLE IF NOT EXISTS idempotency_responses (
        idempotency_key text NOT NULL,
        route text NOT NULL,
        body_hash text NOT NULL,
        status integer NOT NULL,
        response_body jsonb NOT NULL,
        created_at text NOT NULL,
        PRIMARY KEY (idempotency_key, route, body_hash)
    )""",
)


async def ensure_schema(pool: AsyncConnectionPool) -> None:
    async with pool.connection() as conn:
        for statement in _DDL:
            await conn.execute(statement)
        await conn.commit()
