"""Postgres + pgvector knowledge store: per-community rules + a retrievable base of past posts.

The vector is passed as a text literal cast to ``::vector`` so we need no per-connection type
adapter. Similarity uses cosine distance (``<=>``); a missing/empty embedding short-circuits to no
precedent rather than ordering by a degenerate vector.
"""

from __future__ import annotations

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from ..ports import KnowledgeStore
from ..schemas import CommunityRule, ModerationDecision


def _vector_literal(embedding: list[float]) -> str:
    return "[" + ",".join(repr(float(x)) for x in embedding) + "]"


def _summary(decision: ModerationDecision) -> str:
    return f"{decision.verdict} ({decision.rule_id}): {decision.reason}"


class PgKnowledgeStore(KnowledgeStore):
    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool

    async def rules_for(self, community_id: str) -> list[CommunityRule]:
        async with self._pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT rule_id, text, severity FROM community_rules "
                "WHERE community_id = %s ORDER BY rule_id",
                (community_id,),
            )
            rows = await cur.fetchall()
            return [CommunityRule.model_validate(row) for row in rows]

    async def similar(
        self, community_id: str, embedding: list[float], *, limit: int = 3
    ) -> list[str]:
        if not embedding:
            return []
        async with self._pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT summary FROM post_embeddings "
                "WHERE community_id = %s AND embedding IS NOT NULL "
                "ORDER BY embedding <=> %s::vector LIMIT %s",
                (community_id, _vector_literal(embedding), limit),
            )
            rows = await cur.fetchall()
            return [str(row["summary"]) for row in rows]

    async def remember(
        self,
        *,
        post_id: str,
        community_id: str,
        title: str,
        body: str,
        embedding: list[float],
        decision: ModerationDecision,
    ) -> None:
        vec = _vector_literal(embedding) if embedding else None
        async with self._pool.connection() as conn:
            await conn.execute(
                "INSERT INTO post_embeddings "
                "(post_id, community_id, title, body_excerpt, summary, embedding, created_at) "
                "VALUES (%s,%s,%s,%s,%s,%s::vector,%s) "
                "ON CONFLICT (post_id) DO UPDATE SET "
                "summary = EXCLUDED.summary, embedding = EXCLUDED.embedding",
                (
                    post_id,
                    community_id,
                    title[:300],
                    body[:2000],
                    _summary(decision),
                    vec,
                    decision.created_at,
                ),
            )
            await conn.commit()

    async def count_embeddings(self) -> int:
        async with self._pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            await cur.execute("SELECT count(*) AS n FROM post_embeddings")
            row = await cur.fetchone()
            return int(row["n"]) if row else 0
