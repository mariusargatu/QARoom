"""Shared test builders. Fresh instances per test — no shared mutable state."""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from moderator_agent.api.app import AppDeps, build_app
from moderator_agent.config import Settings
from moderator_agent.determinism import Clock, IdGenerator, seeded_trio
from moderator_agent.lamport import LamportGate
from moderator_agent.llm import Embedder, LlmClient, RuleKeywordLlm, ZeroEmbedder
from moderator_agent.persistence.memory import (
    InMemoryDecisionStore,
    InMemoryIdempotencyStore,
    InMemoryKnowledgeStore,
    InMemoryPolicyCorpusStore,
)
from moderator_agent.ports import EventPublisher
from moderator_agent.rerank import IdentityReranker, Reranker
from moderator_agent.schemas import CommunityRule, LlmVerdict, PolicyEntry, PostCreatedEvent
from moderator_agent.workflow.graph import ModerationWorkflow


def _ulid(n: int) -> str:
    return str(n).rjust(26, "0")


COMMUNITY = f"comm_{_ulid(0)}"
POST = f"post_{_ulid(1)}"
AUTHOR = f"user_{_ulid(1)}"
EVENT = f"evt_{_ulid(1)}"

DEFAULT_RULES = [
    CommunityRule(rule_id="no-harassment", text="No personal attacks or slurs.", severity="high"),
    CommunityRule(rule_id="no-spam", text="No spam or undisclosed advertising.", severity="medium"),
]

# The corpus the agent retrieves over (FR1/FR2). Mirrors DEFAULT_RULES as `rule` entries plus one
# escalation guideline, so the fake LLM's cited rule is in the retrieved set (citation grounding keeps
# it) and retrieve-then-reason has something to surface.
DEFAULT_CORPUS = [
    PolicyEntry(entry_id=r.rule_id, entry_type="rule", text=r.text, severity=r.severity)
    for r in DEFAULT_RULES
] + [
    PolicyEntry(
        entry_id="escalate-ambiguous-intent",
        entry_type="guideline",
        text="When intent is ambiguous and no rule clearly applies, escalate to a human.",
    )
]


def make_corpus(community_id: str = COMMUNITY) -> InMemoryPolicyCorpusStore:
    corpus = InMemoryPolicyCorpusStore()
    corpus.set_entries(community_id, DEFAULT_CORPUS)
    return corpus


class RecordingPublisher(EventPublisher):
    def __init__(self) -> None:
        self.published: list[dict] = []

    async def publish(self, **kwargs: object) -> None:
        self.published.append(dict(kwargs))


class CountingLlm(LlmClient):
    """Wraps a deterministic LLM and counts ``classify`` calls — lets a test prove a replay served
    from the idempotency cache (or a checkpointer) did NOT re-invoke the model."""

    def __init__(self, inner: LlmClient | None = None) -> None:
        self._inner = inner or RuleKeywordLlm()
        self.calls = 0

    @property
    def model(self) -> str:
        return self._inner.model

    def classify(self, *, system_prompt: str, post_text: str) -> LlmVerdict:
        self.calls += 1
        return self._inner.classify(system_prompt=system_prompt, post_text=post_text)


def make_event(
    *,
    event_id: str = EVENT,
    post_id: str = POST,
    community_id: str = COMMUNITY,
    author_id: str = AUTHOR,
    title: str = "Friendly hello",
    body: str = "A warm welcome to the community.",
) -> PostCreatedEvent:
    return PostCreatedEvent(
        event_id=event_id,
        post_id=post_id,
        community_id=community_id,
        author_id=author_id,
        title=title,
        body=body,
        created_at="2026-06-04T00:00:00.000Z",
    )


@dataclass(frozen=True)
class _BuiltWorkflow:
    """The full wired set both ``make_workflow`` and ``make_app_client`` need — so the API-client path
    gets identical set_rules/hasattr handling and the same clock/ids/corpus as the workflow path."""

    workflow: ModerationWorkflow
    decisions: InMemoryDecisionStore
    knowledge: InMemoryKnowledgeStore
    corpus: InMemoryPolicyCorpusStore
    clock: Clock
    ids: IdGenerator


def _build_workflow(
    *,
    settings: Settings,
    llm: LlmClient | None = None,
    embedder: Embedder | None = None,
    reranker: Reranker | None = None,
    decisions: InMemoryDecisionStore | None = None,
    knowledge: InMemoryKnowledgeStore | None = None,
    corpus: InMemoryPolicyCorpusStore | None = None,
    publisher: EventPublisher | None = None,
    sink: list[dict] | None = None,
    community_id: str = COMMUNITY,
    checkpointer: object = None,
) -> _BuiltWorkflow:
    clock, ids, _ = seeded_trio()
    decisions = decisions or InMemoryDecisionStore()
    knowledge = knowledge or InMemoryKnowledgeStore()
    # Only the in-memory store carries rules; a custom double (e.g. a failure injector) may not.
    if hasattr(knowledge, "set_rules"):
        knowledge.set_rules(community_id, DEFAULT_RULES)
    corpus = corpus or make_corpus(community_id)
    workflow = ModerationWorkflow(
        llm=llm or RuleKeywordLlm(),
        embedder=embedder or ZeroEmbedder(),
        reranker=reranker or IdentityReranker(),
        knowledge=knowledge,
        corpus=corpus,
        decisions=decisions,
        clock=clock,
        ids=ids,
        lamport=LamportGate(ids),
        settings=settings,
        publisher=publisher,
        checkpointer=checkpointer,
        sink=sink,
    )
    return _BuiltWorkflow(
        workflow=workflow,
        decisions=decisions,
        knowledge=knowledge,
        corpus=corpus,
        clock=clock,
        ids=ids,
    )


def make_workflow(
    *,
    llm: LlmClient | None = None,
    embedder: object | None = None,
    reranker: Reranker | None = None,
    decisions: InMemoryDecisionStore | None = None,
    knowledge: InMemoryKnowledgeStore | None = None,
    corpus: InMemoryPolicyCorpusStore | None = None,
    publisher: EventPublisher | None = None,
    prompt_bug: bool = False,
    settings: Settings | None = None,
    sink: list[dict] | None = None,
    community_id: str = COMMUNITY,
    checkpointer: object = None,
) -> tuple[ModerationWorkflow, InMemoryDecisionStore, InMemoryKnowledgeStore]:
    settings = settings or Settings(moderator_prompt_bug=prompt_bug)
    # The public param stays ``object | None`` (a test may pass a bare embed-double); ``ZeroEmbedder``
    # satisfies ``Embedder``, so the fallback inside ``_build_workflow`` is well-typed once bridged.
    built = _build_workflow(
        settings=settings,
        llm=llm,
        embedder=cast("Embedder | None", embedder),
        reranker=reranker,
        decisions=decisions,
        knowledge=knowledge,
        corpus=corpus,
        publisher=publisher,
        sink=sink,
        community_id=community_id,
        checkpointer=checkpointer,
    )
    return built.workflow, built.decisions, built.knowledge


def make_app_client(*, llm: LlmClient | None = None):
    from fastapi.testclient import TestClient

    settings = Settings()
    built = _build_workflow(settings=settings, llm=llm)
    app = build_app(
        AppDeps(
            workflow=built.workflow,
            decisions=built.decisions,
            knowledge=built.knowledge,
            corpus=built.corpus,
            idempotency=InMemoryIdempotencyStore(),
            clock=built.clock,
            lamport=LamportGate(built.ids),
            settings=settings,
        )
    )
    return TestClient(app)
