"""Integration tests for the Postgres + pgvector stores.

Skipped unless ``QAROOM_TEST_DATABASE_URL`` points at a pgvector-enabled Postgres (the moderator CI
job provides one). The deterministic suite covers the workflow/API via the in-memory fakes; this
proves the SQL itself — dedup on event_id, the advisory-locked single writer, and vector recall.
"""

from __future__ import annotations

import os

import pytest

pytestmark = pytest.mark.integration

_DB = os.environ.get("QAROOM_TEST_DATABASE_URL")
_B = "0" * 26


def _decision(**overrides: object):
    from moderator_agent.schemas import ModerationDecision

    base = {
        "decision_id": f"mdec_{_B}",
        "event_id": f"evt_{_B}",
        "post_id": f"post_{_B}",
        "community_id": f"comm_{_B}",
        "author_id": f"user_{_B}",
        "verdict": "flag",
        "rule_id": "no-harassment",
        "reason": "targets an individual",
        "confidence": 0.9,
        "model": "test-model",
        "created_at": "2026-06-04T00:00:00.000Z",
    }
    base.update(overrides)
    return ModerationDecision.model_validate(base)


@pytest.mark.skipif(not _DB, reason="needs QAROOM_TEST_DATABASE_URL (pgvector Postgres)")
async def test_decision_store_dedups_on_event_id() -> None:
    from moderator_agent.persistence.db import open_pool
    from moderator_agent.persistence.decisions import PgDecisionStore
    from moderator_agent.persistence.migrate import ensure_schema

    pool = await open_pool(_DB)  # type: ignore[arg-type]
    try:
        await ensure_schema(pool)
        async with pool.connection() as conn:
            await conn.execute("DELETE FROM moderation_decisions")
            await conn.commit()
        store = PgDecisionStore(pool)
        assert await store.record(_decision()) is True
        # Same event_id, different decision_id → rejected as a duplicate.
        assert await store.record(_decision(decision_id=f"mdec_{'0' * 25}1")) is False
        community = f"comm_{_B}"
        assert len(await store.list_for(community)) == 1
        found = await store.find_by_event(community, f"evt_{_B}")
        assert found is not None and found.decision_id == f"mdec_{_B}"
    finally:
        await pool.close()


@pytest.mark.skipif(not _DB, reason="needs QAROOM_TEST_DATABASE_URL (pgvector Postgres)")
async def test_knowledge_store_seeds_rules_and_remembers_embeddings() -> None:
    from pathlib import Path

    from moderator_agent.persistence.db import open_pool
    from moderator_agent.persistence.knowledge import PgKnowledgeStore
    from moderator_agent.persistence.migrate import ensure_schema
    from moderator_agent.persistence.rules_seed import seed_rules

    pool = await open_pool(_DB)  # type: ignore[arg-type]
    try:
        await ensure_schema(pool)
        rules_dir = Path(__file__).resolve().parents[1] / "rules"
        await seed_rules(pool, rules_dir)
        store = PgKnowledgeStore(pool)
        rules = await store.rules_for(f"comm_{_B}")
        assert any(r.rule_id == "no-harassment" for r in rules)
        await store.remember(
            post_id=f"post_{_B}",
            community_id=f"comm_{_B}",
            title="t",
            body="b",
            embedding=[0.1] * 1536,
            decision=_decision(),
        )
        assert await store.count_embeddings() >= 1
        assert await store.similar(f"comm_{_B}", [0.1] * 1536)
    finally:
        await pool.close()


@pytest.mark.skipif(not _DB, reason="needs QAROOM_TEST_DATABASE_URL (pgvector Postgres)")
async def test_idempotency_store_replays_and_detects_conflicts() -> None:
    # Proves the SQL the in-memory twin only mimics: the idempotency_responses DDL applies, the
    # ::jsonb cast round-trips a dict, ON CONFLICT DO NOTHING is first-writer-wins, and the `<>`
    # conflicts query fires on same-key-same-route-different-body.
    from moderator_agent.persistence.db import open_pool
    from moderator_agent.persistence.idempotency import PgIdempotencyStore
    from moderator_agent.persistence.migrate import ensure_schema

    pool = await open_pool(_DB)  # type: ignore[arg-type]
    try:
        await ensure_schema(pool)
        async with pool.connection() as conn:
            await conn.execute("DELETE FROM idempotency_responses")
            await conn.commit()
        store = PgIdempotencyStore(pool)
        route = "POST /api/communities/comm_x/posts/post_x/review"
        body = {"verdict": "flag", "confidence": 0.9, "reason": "accents: crème ☃"}

        # Miss before write.
        assert await store.find(key="k1", route=route, body_hash="h1") is None
        # Store, then replay returns the exact (status, jsonb body).
        await store.store(
            key="k1", route=route, body_hash="h1", status=200, body=body, created_at="t"
        )
        hit = await store.find(key="k1", route=route, body_hash="h1")
        assert hit is not None and hit.status == 200 and hit.body == body

        # Same key+route, DIFFERENT body_hash → conflict; same hash → not a conflict.
        assert await store.conflicts(key="k1", route=route, body_hash="h2") is True
        assert await store.conflicts(key="k1", route=route, body_hash="h1") is False

        # ON CONFLICT DO NOTHING: a second store on the same (key, route, hash) keeps the first.
        await store.store(
            key="k1", route=route, body_hash="h1", status=500, body={"x": 1}, created_at="t2"
        )
        again = await store.find(key="k1", route=route, body_hash="h1")
        assert again is not None and again.status == 200 and again.body == body
    finally:
        await pool.close()
