"""Shared test builders. Fresh instances per test — no shared mutable state."""

from __future__ import annotations

from moderator_agent.api.app import AppDeps, build_app
from moderator_agent.config import Settings
from moderator_agent.determinism import seeded_trio
from moderator_agent.lamport import LamportGate
from moderator_agent.llm import LlmClient, RuleKeywordLlm, ZeroEmbedder
from moderator_agent.persistence.memory import (
    InMemoryDecisionStore,
    InMemoryIdempotencyStore,
    InMemoryKnowledgeStore,
)
from moderator_agent.ports import EventPublisher
from moderator_agent.schemas import CommunityRule, LlmVerdict, PostCreatedEvent
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


def make_workflow(
    *,
    llm: LlmClient | None = None,
    decisions: InMemoryDecisionStore | None = None,
    knowledge: InMemoryKnowledgeStore | None = None,
    publisher: EventPublisher | None = None,
    prompt_bug: bool = False,
    sink: list[dict] | None = None,
    community_id: str = COMMUNITY,
    checkpointer: object = None,
) -> tuple[ModerationWorkflow, InMemoryDecisionStore, InMemoryKnowledgeStore]:
    settings = Settings(moderator_prompt_bug=prompt_bug)
    clock, ids, _ = seeded_trio()
    decisions = decisions or InMemoryDecisionStore()
    knowledge = knowledge or InMemoryKnowledgeStore()
    knowledge.set_rules(community_id, DEFAULT_RULES)
    workflow = ModerationWorkflow(
        llm=llm or RuleKeywordLlm(),
        embedder=ZeroEmbedder(),
        knowledge=knowledge,
        decisions=decisions,
        clock=clock,
        ids=ids,
        lamport=LamportGate(ids),
        settings=settings,
        publisher=publisher,
        checkpointer=checkpointer,
        sink=sink,
    )
    return workflow, decisions, knowledge


def make_app_client(*, llm: LlmClient | None = None):
    from fastapi.testclient import TestClient

    settings = Settings()
    clock, ids, _ = seeded_trio()
    decisions = InMemoryDecisionStore()
    knowledge = InMemoryKnowledgeStore()
    knowledge.set_rules(COMMUNITY, DEFAULT_RULES)
    workflow = ModerationWorkflow(
        llm=llm or RuleKeywordLlm(),
        embedder=ZeroEmbedder(),
        knowledge=knowledge,
        decisions=decisions,
        clock=clock,
        ids=ids,
        lamport=LamportGate(ids),
        settings=settings,
    )
    app = build_app(
        AppDeps(
            workflow=workflow,
            decisions=decisions,
            knowledge=knowledge,
            idempotency=InMemoryIdempotencyStore(),
            clock=clock,
            lamport=LamportGate(ids),
            settings=settings,
        )
    )
    return TestClient(app)
