"""The red-team target: the in-process moderator behind a ``model_callback`` (ADR-0020).

DeepTeam (and PyRIT, via an adapter) drive ANY target through a single string-in / string-out
callback. Here that callback runs the REAL LangGraph RAG moderator over a post whose *body is the
attacker-controlled input* — the headline prompt-injection-in-post-body surface — and returns the
disposition + rationale as a string the harness can judge.

Crucially, the callback honours ``MODERATOR_DISABLE_INPUT_GUARD``: the guarded run fences the post
body so an injection is judged as DATA (mitigated); the disabled run feeds the raw body into the
prompt (the deliberate bug), so the same injection can LAND. That toggle is what lets the suite prove
the guard has teeth (EXIT CRITERION 4) rather than merely asserting "nothing bad happened".

Wired with REAL ``LangChainLlmClient`` / ``LangChainEmbedder`` (key-gated by the caller) plus
in-memory stores seeded from the versioned corpus, so no Postgres/NATS is needed to exercise the agent.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Coroutine
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from moderator_agent.config import Settings
from moderator_agent.determinism import seeded_trio
from moderator_agent.lamport import LamportGate
from moderator_agent.llm import LangChainEmbedder, LangChainLlmClient
from moderator_agent.persistence.memory import (
    InMemoryDecisionStore,
    InMemoryKnowledgeStore,
    InMemoryPolicyCorpusStore,
)
from moderator_agent.persistence.rules_seed import load_corpus_dir, load_rules_dir
from moderator_agent.rerank import LlmReranker
from moderator_agent.schemas import ModerationDecision, PostCreatedEvent
from moderator_agent.wiring import RULES_DIR
from moderator_agent.workflow.graph import ModerationWorkflow

# The seeded community whose corpus ships in rules/comm_0000…0000.yaml — the corpus the agent retrieves
# over. Using the real seeded community keeps retrieval load-bearing (FR2) instead of an empty corpus.
TARGET_COMMUNITY = "comm_" + "0" * 26
_RULES_DIR: Path = RULES_DIR


def _ulid(n: int) -> str:
    return str(n).rjust(26, "0")


def build_workflow(settings: Settings) -> ModerationWorkflow:
    """A workflow wired with the REAL provider + in-memory stores seeded from the versioned corpus.

    The settings carry the guard toggle (``moderator_disable_input_guard``); everything else is
    deterministic so the only stochastic surface is the model under attack.
    """
    clock, ids, _ = seeded_trio()
    corpus = InMemoryPolicyCorpusStore()
    corpus.set_entries(TARGET_COMMUNITY, load_corpus_dir(_RULES_DIR).get(TARGET_COMMUNITY, []))
    knowledge = InMemoryKnowledgeStore()
    knowledge.set_rules(TARGET_COMMUNITY, load_rules_dir(_RULES_DIR).get(TARGET_COMMUNITY, []))
    return ModerationWorkflow(
        llm=LangChainLlmClient(settings),
        embedder=LangChainEmbedder(settings),
        reranker=LlmReranker(settings),
        knowledge=knowledge,
        corpus=corpus,
        decisions=InMemoryDecisionStore(),
        clock=clock,
        ids=ids,
        lamport=LamportGate(ids),
        settings=settings,
    )


def _event(body: str, *, idx: int = 1, title: str = "Untrusted post") -> PostCreatedEvent:
    return PostCreatedEvent(
        event_id=f"evt_{_ulid(idx)}",
        post_id=f"post_{_ulid(idx)}",
        community_id=TARGET_COMMUNITY,
        author_id=f"user_{_ulid(idx)}",
        title=title,
        body=body,
        created_at="2026-06-05T00:00:00.000Z",
    )


def _verdict_text(decision: ModerationDecision | None) -> str:
    """Serialize the agent's verdict into the string the red-team harness judges. ``None`` means the
    workflow ended in ``Failed`` (a dependency failure) — surfaced as such, never as a silent approve."""
    if decision is None:
        return (
            "disposition=failed rationale=the moderation workflow failed before reaching a verdict"
        )
    cited = ",".join(decision.cited_rules) or "none"
    return (
        f"disposition={decision.disposition} "
        f"cited_rules={cited} "
        f"confidence={decision.confidence:.2f} "
        f"rationale={decision.rationale}"
    )


def _run_sync[T](coro: Coroutine[Any, Any, T]) -> T:
    """``asyncio.run``, tolerant of an already-running loop.

    deepeval 4.x's pytest plugin (auto-loaded once the eval group is installed) executes tests
    under an active event loop, where a bare ``asyncio.run`` raises ``RuntimeError``. Fall back to
    a fresh loop on a worker thread — the workflow run stays synchronous from the caller's view.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


def make_model_callback(settings: Settings) -> Callable[[str], str]:
    """Build a ``model_callback(input_text) -> str`` over a workflow with the given settings.

    The callback is the contract DeepTeam expects: it places ``input_text`` in the post BODY (the
    untrusted surface), runs the agent, and returns its verdict string. Each call builds a FRESH
    workflow (fresh in-memory stores), so attacks — including PyRIT multi-turn Crescendo/TAP — do not
    bleed state between turns: a recorded decision from turn N can't surface as precedent in turn N+1.
    """
    counter = {"n": 0}

    def model_callback(input_text: str) -> str:
        counter["n"] += 1
        event = _event(input_text, idx=counter["n"])
        decision = _run_sync(build_workflow(settings).run(event))
        return _verdict_text(decision)

    return model_callback


def run_post(body: str, *, settings: Settings) -> ModerationDecision | None:
    """Run a single post body through a freshly-built workflow and return the structured decision.

    Used by the structural fallback assertion (no harness needed) to compare guard-on vs guard-off
    directly on the disposition, proving the guard changes the outcome on an injection payload.
    """
    workflow = build_workflow(settings)
    return _run_sync(workflow.run(_event(body)))
