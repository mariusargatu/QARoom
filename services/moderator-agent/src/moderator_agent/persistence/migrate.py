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
    """CREATE TABLE IF NOT EXISTS moderation_decisions (
        decision_id text PRIMARY KEY,
        event_id text NOT NULL UNIQUE,
        post_id text NOT NULL,
        community_id text NOT NULL,
        author_id text NOT NULL,
        verdict text NOT NULL,
        rule_id text,
        reason text NOT NULL,
        confidence double precision NOT NULL,
        model text NOT NULL,
        created_at text NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS moderation_decisions_community_idx "
    "ON moderation_decisions (community_id, created_at)",
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
