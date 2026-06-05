"""Async Postgres connection pool (psycopg 3).

Read methods open a ``dict_row`` cursor explicitly (see decisions/knowledge), so the pool keeps its
default row factory — that also keeps the static pool type simple.
"""

from __future__ import annotations

from psycopg_pool import AsyncConnectionPool


async def open_pool(
    database_url: str, *, min_size: int = 1, max_size: int = 8
) -> AsyncConnectionPool:
    pool = AsyncConnectionPool(database_url, min_size=min_size, max_size=max_size, open=False)
    await pool.open(wait=True)
    # psycopg_pool's generic connection-type parameter is invariant and unbound at construction;
    # the default AsyncConnection[TupleRow] is what we use (reads open dict_row cursors explicitly).
    return pool  # pyright: ignore[reportReturnType]
