"""Postgres + pgvector policy-corpus store (FR1/FR2, ADR-0020).

The corpus is the per-community body of policy the moderator RETRIEVES over — rules and escalation
guidelines (and, later, seeded precedent). ``retrieve`` ranks by cosine distance (``<=>``) so the
draft node reasons over the nearest entries, making retrieval load-bearing rather than prompt-baked.
A missing/empty embedding short-circuits to a stable id order (the deterministic-test path uses the
zero embedder, so there is no meaningful nearest-neighbour ranking to honour).
"""

from __future__ import annotations

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from ..ports import PolicyCorpusStore
from ..schemas import PolicyEntry
from .vectors import vector_literal

# Only rule/guideline entries are reasoned over per post; precedent entries are retrieved separately
# (as past-decision summaries) so the two precision/recall surfaces stay distinct.
_REASONED_TYPES = ("rule", "guideline")


def _entry(row: dict) -> PolicyEntry:
    return PolicyEntry(
        entry_id=row["entry_id"],
        entry_type=row["entry_type"],
        text=row["text"],
        severity=row["severity"],
    )


class PgPolicyCorpusStore(PolicyCorpusStore):
    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool

    async def retrieve(
        self, community_id: str, embedding: list[float], *, limit: int = 5
    ) -> list[PolicyEntry]:
        async with self._pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            # A missing OR all-zero embedding has no meaningful nearest-neighbour ranking (cosine `<=>`
            # on a zero vector is NaN, which sorts arbitrarily) — fall back to a stable id order, which
            # also matches the in-memory double. The deterministic ZeroEmbedder hits this path.
            if not embedding or not any(embedding):
                await cur.execute(
                    "SELECT entry_id, entry_type, text, severity FROM policy_corpus "
                    "WHERE community_id = %s AND entry_type = ANY(%s) ORDER BY entry_id LIMIT %s",
                    (community_id, list(_REASONED_TYPES), limit),
                )
            else:
                # `entry_id` breaks ties so equal-distance rows order deterministically.
                await cur.execute(
                    "SELECT entry_id, entry_type, text, severity FROM policy_corpus "
                    "WHERE community_id = %s AND entry_type = ANY(%s) AND embedding IS NOT NULL "
                    "ORDER BY embedding <=> %s::vector, entry_id LIMIT %s",
                    (community_id, list(_REASONED_TYPES), vector_literal(embedding), limit),
                )
            return [_entry(row) for row in await cur.fetchall()]

    async def corpus_for(self, community_id: str) -> list[PolicyEntry]:
        async with self._pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT entry_id, entry_type, text, severity FROM policy_corpus "
                "WHERE community_id = %s ORDER BY entry_id",
                (community_id,),
            )
            return [_entry(row) for row in await cur.fetchall()]

    async def count_entries(self) -> int:
        async with self._pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            await cur.execute("SELECT count(*) AS n FROM policy_corpus")
            row = await cur.fetchone()
            return int(row["n"]) if row else 0
