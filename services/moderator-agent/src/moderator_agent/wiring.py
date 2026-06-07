"""Composition root — wire the production graph (Postgres + pgvector + NATS + OpenAI) and a
schema-only variant (in-memory fakes) used to generate the OpenAPI document offline.

The production wiring is exercised by the cluster-smoke (/health, /ready) and integration tests;
the deterministic unit suite builds the app straight from ``AppDeps`` with in-memory fakes.
"""

from __future__ import annotations

import contextlib
import datetime as _dt
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from fastapi import FastAPI

from . import telemetry
from .api.app import AppDeps, build_app
from .config import Settings
from .consumer import PostEventConsumer
from .determinism import (
    Clock,
    CryptoRandomness,
    FixedClock,
    IdGenerator,
    UlidIdGenerator,
    production_trio,
)
from .lamport import LamportGate
from .langfuse_integration import LangfuseClient
from .langfuse_seed import seed_langfuse
from .llm import LangChainEmbedder, LangChainLlmClient, RuleKeywordLlm, ZeroEmbedder
from .persistence.corpus import PgPolicyCorpusStore
from .persistence.db import open_pool
from .persistence.decisions import PgDecisionStore
from .persistence.idempotency import PgIdempotencyStore
from .persistence.knowledge import PgKnowledgeStore
from .persistence.memory import (
    InMemoryDecisionStore,
    InMemoryIdempotencyStore,
    InMemoryKnowledgeStore,
    InMemoryPolicyCorpusStore,
)
from .persistence.migrate import ensure_schema
from .persistence.rules_seed import seed_corpus, seed_rules
from .publisher import NatsEventPublisher
from .workflow.graph import ModerationWorkflow

RULES_DIR = Path(__file__).resolve().parents[2] / "rules"


def _trio(settings: Settings) -> tuple[Clock, IdGenerator, object]:
    if settings.replaying:
        instant = _dt.datetime.fromisoformat(settings.snapshot_clock_seed.replace("Z", "+00:00"))
        return FixedClock(instant), UlidIdGenerator(), CryptoRandomness()
    return production_trio()


@dataclass
class Runtime:
    app: FastAPI
    shutdown: Callable[[], Awaitable[None]]


async def build_runtime(settings: Settings) -> Runtime:
    import nats

    telemetry.setup_telemetry(settings)
    clock, ids, _ = _trio(settings)
    lamport = LamportGate(ids)

    embedder = LangChainEmbedder(settings)

    pool = await open_pool(settings.database_url)
    await ensure_schema(pool)
    await seed_rules(pool, RULES_DIR)
    # Embed + seed the policy corpus the agent retrieves over (FR1). Best-effort: a boot without an
    # embedding key still serves /health, /ready; the corpus fills once the key is present.
    with contextlib.suppress(Exception):
        await seed_corpus(pool, RULES_DIR, embedder)
    decisions = PgDecisionStore(pool)
    knowledge = PgKnowledgeStore(pool)
    corpus = PgPolicyCorpusStore(pool)
    idempotency = PgIdempotencyStore(pool)

    stack = contextlib.AsyncExitStack()
    checkpointer = await _open_checkpointer(settings, stack)

    # One NATS connection, shared by the publisher and the consumer (one JetStream context).
    nc = await nats.connect(settings.nats_url)
    js = nc.jetstream()
    publisher = NatsEventPublisher(js)

    # Langfuse LLM-observability. Idempotently seed the live-editable prompt + golden dataset + human
    # annotation queue so they re-create on a fresh stack; best-effort, never blocks boot. No-op when
    # Langfuse is not configured.
    langfuse = LangfuseClient(settings)
    langfuse_queue_id = await seed_langfuse(langfuse, settings)

    workflow = ModerationWorkflow(
        llm=LangChainLlmClient(settings),
        embedder=embedder,
        knowledge=knowledge,
        corpus=corpus,
        decisions=decisions,
        clock=clock,
        ids=ids,
        lamport=lamport,
        settings=settings,
        publisher=publisher,
        checkpointer=checkpointer,
        langfuse=langfuse,
        langfuse_queue_id=langfuse_queue_id,
    )

    async def ready_check() -> bool:
        try:
            async with pool.connection() as conn:
                await conn.execute("SELECT 1")
            return True
        except Exception:
            return False

    deps = AppDeps(
        workflow=workflow,
        decisions=decisions,
        knowledge=knowledge,
        corpus=corpus,
        idempotency=idempotency,
        clock=clock,
        lamport=lamport,
        settings=settings,
        ready_check=ready_check,
    )
    app = build_app(deps)

    consumer = PostEventConsumer(settings, workflow, js)
    await consumer.start()

    async def shutdown() -> None:
        await consumer.stop()
        with contextlib.suppress(Exception):
            await nc.close()
        await stack.aclose()
        await pool.close()

    return Runtime(app=app, shutdown=shutdown)


async def _open_checkpointer(settings: Settings, stack: contextlib.AsyncExitStack) -> object:
    """LangGraph Postgres checkpointer (thread_id = event_id dedup). Falls back to None — the
    decision store's unique event_id is the correctness belt regardless (ADR-0018)."""
    try:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

        saver = await stack.enter_async_context(
            AsyncPostgresSaver.from_conn_string(settings.database_url)
        )
        await saver.setup()
        return saver
    except Exception:
        return None


def build_schema_app() -> FastAPI:
    """An app wired with in-memory fakes — for offline OpenAPI generation and TestClient use."""
    settings = Settings()
    clock, ids, _ = production_trio()
    lamport = LamportGate(ids)
    decisions = InMemoryDecisionStore()
    knowledge = InMemoryKnowledgeStore()
    corpus = InMemoryPolicyCorpusStore()
    workflow = ModerationWorkflow(
        llm=RuleKeywordLlm(),
        embedder=ZeroEmbedder(),
        knowledge=knowledge,
        corpus=corpus,
        decisions=decisions,
        clock=clock,
        ids=ids,
        lamport=lamport,
        settings=settings,
    )
    return build_app(
        AppDeps(
            workflow=workflow,
            decisions=decisions,
            knowledge=knowledge,
            corpus=corpus,
            idempotency=InMemoryIdempotencyStore(),
            clock=clock,
            lamport=lamport,
            settings=settings,
        )
    )
