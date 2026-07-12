"""Shared builder for the REAL live-LLM RAG target the eval entrypoints exercise.

The DeepEval RAG suite (``evals/deepeval``), the DeepTeam/PyRIT red-team target (``evals/redteam``),
the ``model_compare`` cost sweep, and the Langfuse dataset run each need the SAME thing: the LangGraph
moderator wired with the production ``LangChainLlmClient`` / ``LangChainEmbedder`` / ``LlmReranker`` over
stores seeded from the versioned policy corpus. That wiring used to be copy-pasted (the tenant constant,
a ULID helper, an event factory, the ``ModerationWorkflow`` construction) into every entrypoint; this is
the one place it lives now. Every knob each site varied is a keyword here — nothing else changed.

IMPORT DISCIPLINE: this module must import WITHOUT the key-gated ``eval`` group (deepeval/deepteam/pyrit),
because ``evals/deepeval/_support.py`` imports ``build_live_workflow`` at collection time. It only touches
core moderator modules; the live LLM/embedder clients are *instantiated* inside ``build_live_workflow``,
never at import, so collection stays key-gate-off.
"""

from __future__ import annotations

from .config import Settings
from .determinism import Clock, IdGenerator, seeded_trio
from .lamport import LamportGate
from .langfuse_integration import LangfuseClient
from .llm import LangChainEmbedder, LangChainLlmClient
from .persistence.memory import (
    InMemoryDecisionStore,
    InMemoryKnowledgeStore,
    InMemoryPolicyCorpusStore,
)
from .persistence.rules_seed import load_corpus_dir, load_rules_dir
from .ports import PolicyCorpusStore
from .rerank import LlmReranker
from .schemas import PostCreatedEvent
from .wiring import RULES_DIR
from .workflow.graph import ModerationWorkflow

# The seeded community whose corpus ships in ``rules/comm_0000…0000.yaml`` — the corpus every eval target
# retrieves over. Using the real seeded community keeps retrieval load-bearing (FR2) instead of empty.
EVAL_COMMUNITY = "comm_" + "0" * 26


def _ulid(n: int) -> str:
    return str(n).rjust(26, "0")


def build_live_workflow(
    settings: Settings,
    *,
    community_id: str = EVAL_COMMUNITY,
    clock: Clock | None = None,
    ids: IdGenerator | None = None,
    knowledge: InMemoryKnowledgeStore | None = None,
    corpus: PolicyCorpusStore | None = None,
    seed_knowledge_rules: bool = False,
    langfuse: LangfuseClient | None = None,
) -> tuple[ModerationWorkflow, PolicyCorpusStore]:
    """The REAL RAG target: live LLM + embedder + reranker over the seeded policy corpus.

    Deterministic everywhere except the model itself, so the only stochastic surface under test is the
    provider. Each keyword is a seam a caller varies:

    - ``clock`` / ``ids``: default to ``seeded_trio()`` (the DeepEval / red-team / model-compare path);
      the Langfuse dataset run passes its ``production_trio()`` instances so events + traces share them.
    - ``corpus``: default seeds an ``InMemoryPolicyCorpusStore`` from ``rules/<community>.yaml``; the
      Langfuse run passes a ``PgPolicyCorpusStore`` (corpus already in Postgres — no in-memory seeding).
    - ``knowledge``: default is a bare ``InMemoryKnowledgeStore``; the red-team target injects a poisoned
      precedent store. ``seed_knowledge_rules`` re-seeds its rule set (the red-team target needs it).
    - ``langfuse``: best-effort observability sink (Langfuse run passes it; the others leave it ``None``).

    Returns ``(workflow, corpus)`` so the DeepEval path can judge metrics against the same store.
    """
    if clock is None or ids is None:
        clock, ids, _ = seeded_trio()
    if corpus is None:
        in_memory = InMemoryPolicyCorpusStore()
        in_memory.set_entries(community_id, load_corpus_dir(RULES_DIR).get(community_id, []))
        corpus = in_memory
    knowledge = knowledge or InMemoryKnowledgeStore()
    if seed_knowledge_rules:
        knowledge.set_rules(community_id, load_rules_dir(RULES_DIR).get(community_id, []))
    workflow = ModerationWorkflow(
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
        langfuse=langfuse,
    )
    return workflow, corpus


def gold_event(case: dict, *, community_id: str = EVAL_COMMUNITY) -> PostCreatedEvent:
    """A ``PostCreatedEvent`` from an SME-gold case — the DeepEval RAG suite and the model-compare sweep
    both judge the agent on exactly this event shape (fixed id suffix derived from the case id)."""
    suffix = case["id"].replace("cand_", "").rjust(26, "0")
    return PostCreatedEvent(
        event_id="evt_" + suffix,
        post_id="post_" + suffix,
        community_id=community_id,
        author_id="user_" + "0" * 26,
        title="moderation review",
        body=case["post"],
        created_at="2026-06-05T00:00:00.000Z",
    )


def attack_event(
    body: str,
    *,
    idx: int = 1,
    title: str = "Untrusted post",
    community_id: str = EVAL_COMMUNITY,
) -> PostCreatedEvent:
    """A ``PostCreatedEvent`` whose BODY is the attacker-controlled input — the red-team surface. ``idx``
    makes each turn's ids distinct so multi-turn attacks (PyRIT Crescendo/TAP) don't collide."""
    return PostCreatedEvent(
        event_id=f"evt_{_ulid(idx)}",
        post_id=f"post_{_ulid(idx)}",
        community_id=community_id,
        author_id=f"user_{_ulid(idx)}",
        title=title,
        body=body,
        created_at="2026-06-05T00:00:00.000Z",
    )
