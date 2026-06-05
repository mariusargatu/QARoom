"""Postgres-backed decision store. Single-writer per post (advisory lock), dedup on ``event_id``."""

from __future__ import annotations

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from ..ports import DecisionStore
from ..schemas import ModerationDecision

_COLUMNS = (
    "decision_id, event_id, post_id, community_id, author_id, "
    "verdict, rule_id, reason, confidence, model, created_at"
)


class PgDecisionStore(DecisionStore):
    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool

    async def record(self, decision: ModerationDecision) -> bool:
        async with self._pool.connection() as conn:
            # Single-writer per resource (Commitment 4): serialize concurrent reviews of the same post.
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (decision.post_id,)
            )
            cur = await conn.execute(
                f"INSERT INTO moderation_decisions ({_COLUMNS}) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                "ON CONFLICT (event_id) DO NOTHING",
                (
                    decision.decision_id,
                    decision.event_id,
                    decision.post_id,
                    decision.community_id,
                    decision.author_id,
                    decision.verdict,
                    decision.rule_id,
                    decision.reason,
                    decision.confidence,
                    decision.model,
                    decision.created_at,
                ),
            )
            is_new = cur.rowcount == 1
            await conn.commit()
            return is_new

    async def find_by_event(self, community_id: str, event_id: str) -> ModerationDecision | None:
        async with self._pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                f"SELECT {_COLUMNS} FROM moderation_decisions WHERE community_id = %s AND event_id = %s",
                (community_id, event_id),
            )
            row = await cur.fetchone()
            return ModerationDecision.model_validate(row) if row else None

    async def list_for(self, community_id: str) -> list[ModerationDecision]:
        async with self._pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                f"SELECT {_COLUMNS} FROM moderation_decisions "
                "WHERE community_id = %s ORDER BY created_at, decision_id",
                (community_id,),
            )
            rows = await cur.fetchall()
            return [ModerationDecision.model_validate(row) for row in rows]

    async def get(self, community_id: str, decision_id: str) -> ModerationDecision | None:
        async with self._pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                f"SELECT {_COLUMNS} FROM moderation_decisions "
                "WHERE community_id = %s AND decision_id = %s",
                (community_id, decision_id),
            )
            row = await cur.fetchone()
            return ModerationDecision.model_validate(row) if row else None

    async def count(self) -> int:
        async with self._pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            await cur.execute("SELECT count(*) AS n FROM moderation_decisions")
            row = await cur.fetchone()
            return int(row["n"]) if row else 0
