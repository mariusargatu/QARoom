"""Postgres-backed HTTP idempotency cache (Commitment 4).

Keyed by ``(idempotency_key, route, body_hash)``. ``find`` replays an exact match; ``conflicts``
detects the same key reused with a different body; ``store`` persists with ``ON CONFLICT DO NOTHING``
so two concurrent first-writers settle on one row (first write wins) and both callers still get their
computed response. Mirrors ``@qaroom/messaging``'s helpers.
"""

from __future__ import annotations

import json

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from ..ports import IdempotencyStore, StoredResponse


class PgIdempotencyStore(IdempotencyStore):
    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool

    async def find(self, *, key: str, route: str, body_hash: str) -> StoredResponse | None:
        async with self._pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT status, response_body FROM idempotency_responses "
                "WHERE idempotency_key = %s AND route = %s AND body_hash = %s",
                (key, route, body_hash),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            return StoredResponse(status=int(row["status"]), body=row["response_body"])

    async def conflicts(self, *, key: str, route: str, body_hash: str) -> bool:
        async with self._pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT 1 AS one FROM idempotency_responses "
                "WHERE idempotency_key = %s AND route = %s AND body_hash <> %s LIMIT 1",
                (key, route, body_hash),
            )
            return await cur.fetchone() is not None

    async def store(
        self, *, key: str, route: str, body_hash: str, status: int, body: dict, created_at: str
    ) -> None:
        async with self._pool.connection() as conn:
            await conn.execute(
                "INSERT INTO idempotency_responses "
                "(idempotency_key, route, body_hash, status, response_body, created_at) "
                "VALUES (%s,%s,%s,%s,%s::jsonb,%s) ON CONFLICT DO NOTHING",
                (key, route, body_hash, status, json.dumps(body), created_at),
            )
            await conn.commit()
