"""The LangGraph runner over the moderation model (Milestone 9, ADR-0017/0018).

A real ``StateGraph`` — ``retrieve → classify → record`` with a failure edge to ``END`` — so the
workflow IS the graph the README renders and the conformance test walks. Each node records its
transition into the run state AND emits an ``xstate.transition`` span (``telemetry.emit_transition_span``)
with the same attributes the XState services emit, so the Tracetest reverse-conformance assertion
(ADR-0012) works unchanged. Transitions are appended to a fresh list each step (no mutation), and the
model in ``model.py`` is the sole authority on which transitions are legal.

Idempotency (Commitment 17) is the decision store's job, not the checkpointer's. ``run`` always
supplies the full initial input, so a re-delivery (including a post-crash redelivery) re-invokes the
graph from the start — a second classify — rather than resuming (LangGraph only resumes a thread when
invoked with ``None``, which ``run`` never does). The guarantee: ``record`` returns ``is_new=False``
on a duplicate ``event_id``, the originally-stored decision (and id) is returned, and the republish
carries a stable, decision-derived Msg-Id — so the duplicate is observably a no-op downstream
(ADR-0018). The checkpointer (``thread_id = event_id``) is wired for LangGraph-native run durability
and trace continuity; it does NOT suppress a re-delivery, and the suite pins that the store dedups
identically with or without it.
"""

from __future__ import annotations

import asyncio
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from .. import telemetry
from ..config import Settings
from ..determinism import Clock, IdGenerator
from ..lamport import LamportGate
from ..llm import Embedder, LlmClient
from ..ports import DecisionStore, EventPublisher, KnowledgeStore
from ..problem import ProblemError
from ..schemas import (
    CommunityRule,
    LlmVerdict,
    ModerationDecision,
    PostCreatedEvent,
    iso_z,
)
from ..subjects import (
    MODERATION_DECISION_RECORDED_EVENT,
    MODERATION_DECISION_RECORDED_VERSION,
    moderation_decision_recorded,
)
from . import model as M
from .prompts import build_system_prompt


class WorkflowState(TypedDict, total=False):
    event: dict
    rules: list[dict]
    precedents: list[str]
    embedding: list[float]
    verdict: dict | None
    decision: dict | None
    state: str
    transitions: list[dict]
    error: str | None


class ModerationWorkflow:
    def __init__(
        self,
        *,
        llm: LlmClient,
        embedder: Embedder,
        knowledge: KnowledgeStore,
        decisions: DecisionStore,
        clock: Clock,
        ids: IdGenerator,
        lamport: LamportGate,
        settings: Settings,
        publisher: EventPublisher | None = None,
        checkpointer: Any = None,
        sink: list[dict] | None = None,
    ) -> None:
        self._llm = llm
        self._embedder = embedder
        self._knowledge = knowledge
        self._decisions = decisions
        self._clock = clock
        self._ids = ids
        self._lamport = lamport
        self._settings = settings
        self._publisher = publisher
        self._sink = sink
        self._last_state = M.INITIAL_STATE
        self._graph = self._build(checkpointer)

    @property
    def last_state(self) -> str:
        return self._last_state

    def _build(self, checkpointer: Any) -> Any:
        graph: StateGraph = StateGraph(WorkflowState)
        graph.add_node("retrieve", self._retrieve)
        graph.add_node("classify", self._classify)
        graph.add_node("record", self._record)
        graph.add_edge(START, "retrieve")
        graph.add_conditional_edges(
            "retrieve", self._route, {"continue": "classify", "failed": END}
        )
        graph.add_conditional_edges("classify", self._route, {"continue": "record", "failed": END})
        graph.add_edge("record", END)
        return graph.compile(checkpointer=checkpointer)

    @staticmethod
    def _route(state: WorkflowState) -> str:
        return "failed" if state.get("state") == "Failed" else "continue"

    def _advance(
        self, state: WorkflowState, updates: dict, *, frm: str, event: str, to: str
    ) -> dict:
        at = iso_z(self._clock.now())
        transition = {"from": frm, "to": to, "event": event, "at": at}
        telemetry.emit_transition_span(machine=M.MACHINE, frm=frm, to=to, event=event, at=at)
        if self._sink is not None:
            self._sink.append(transition)
        return {**updates, "state": to, "transitions": [*state.get("transitions", []), transition]}

    def _fail(self, state: WorkflowState, *, frm: str) -> dict:
        return self._advance(
            state, {"error": "dependency_failure"}, frm=frm, event="DependencyFailed", to="Failed"
        )

    def _post_text(self, event: PostCreatedEvent) -> str:
        body = event.body[: self._settings.moderator_max_post_chars]
        return f"Title: {event.title}\n\nBody: {body}"

    async def _retrieve(self, state: WorkflowState) -> dict:
        event = PostCreatedEvent.model_validate(state["event"])
        try:
            rules = await self._knowledge.rules_for(event.community_id)
            embedding = await asyncio.to_thread(self._embedder.embed, self._post_text(event))
            precedents = await self._knowledge.similar(event.community_id, embedding)
        except ProblemError:
            return self._fail(state, frm="Received")
        return self._advance(
            state,
            {
                "rules": [r.model_dump() for r in rules],
                "precedents": precedents,
                "embedding": embedding,
            },
            frm="Received",
            event="ReviewRequested",
            to="Retrieved",
        )

    async def _classify(self, state: WorkflowState) -> dict:
        event = PostCreatedEvent.model_validate(state["event"])
        rules = [CommunityRule.model_validate(r) for r in state.get("rules", [])]
        prompt = build_system_prompt(
            rules, state.get("precedents", []), prompt_bug=self._settings.moderator_prompt_bug
        )
        try:
            verdict = await asyncio.to_thread(
                self._llm.classify, system_prompt=prompt, post_text=self._post_text(event)
            )
        except ProblemError:
            return self._fail(state, frm="Retrieved")
        return self._advance(
            state,
            {"verdict": verdict.model_dump()},
            frm="Retrieved",
            event="ContextRetrieved",
            to="Classified",
        )

    async def _record(self, state: WorkflowState) -> dict:
        event = PostCreatedEvent.model_validate(state["event"])
        verdict = LlmVerdict.model_validate(state["verdict"])
        decision = ModerationDecision(
            decision_id=self._ids.next("mdec"),
            event_id=event.event_id,
            post_id=event.post_id,
            community_id=event.community_id,
            author_id=event.author_id,
            verdict=verdict.verdict,
            rule_id=verdict.rule_id,
            reason=verdict.reason,
            confidence=verdict.confidence,
            model=self._llm.model,
            created_at=iso_z(self._clock.now()),
        )
        try:
            is_new = await self._decisions.record(decision)
            if is_new:
                # The DB write IS the commit. remember + lamport.bump happen exactly once per
                # decision, independent of publish — lamport tracks the committed write (ADR-0018).
                await self._knowledge.remember(
                    post_id=event.post_id,
                    community_id=event.community_id,
                    title=event.title,
                    body=event.body,
                    embedding=state.get("embedding", []),
                    decision=decision,
                )
                self._lamport.bump()
            else:
                # A duplicate delivery: return the originally stored decision/id (not the freshly
                # minted one) so the result is observably idempotent. ON CONFLICT (event_id) means a
                # row MUST exist; a None here is a broken invariant, not a recoverable miss — fail
                # fast rather than silently republishing under a fresh (and divergent) Msg-Id.
                existing = await self._decisions.find_by_event(event.community_id, event.event_id)
                if existing is None:
                    raise ProblemError(
                        slug="decision-retrieval-failed",
                        title="Stored decision missing after a duplicate was detected",
                        status=500,
                        failure_domain="internal_error",
                        retryable=True,
                    )
                decision = existing
        except ProblemError:
            return self._fail(state, frm="Classified")
        # Publish on EVERY delivery, OUTSIDE the dedup guard and the ProblemError catch. The Msg-Id is
        # derived from the decision id, so a republish (the safety net when no checkpoint suppressed a
        # duplicate) is dropped downstream by JetStream's duplicate_window + the consumer's dedup. A
        # publish failure is NOT a ProblemError: it propagates → the consumer naks → redelivery
        # re-attempts the publish. This is the outbox-free at-least-once guarantee (ADR-0018) — without
        # it, a publish failure on first delivery would leave a decision persisted but never published.
        await self._publish(decision)
        return self._advance(
            state,
            {"decision": decision.model_dump()},
            frm="Classified",
            event="VerdictProduced",
            to="Recorded",
        )

    async def _publish(self, decision: ModerationDecision) -> None:
        if self._publisher is None:
            return
        # Stable Msg-Id per decision: `evt_` + the decision's ULID body. A redelivery republishes the
        # SAME id, so it is deduped rather than producing a second downstream event (ADR-0018).
        emitted = decision.to_event(event_id="evt_" + decision.decision_id.split("_", 1)[1])
        await self._publisher.publish(
            subject=moderation_decision_recorded(decision.community_id),
            event_name=MODERATION_DECISION_RECORDED_EVENT,
            event_version=MODERATION_DECISION_RECORDED_VERSION,
            community_id=decision.community_id,
            event_id=emitted.event_id,
            payload=emitted.model_dump(mode="json"),
        )

    async def run(self, event: PostCreatedEvent) -> ModerationDecision | None:
        """Run one review. Returns the decision, or ``None`` if the workflow ended in ``Failed``."""
        initial: WorkflowState = {
            "event": event.model_dump(),
            "state": M.INITIAL_STATE,
            "transitions": [],
        }
        config: dict = {"configurable": {"thread_id": event.event_id}}
        final = await self._graph.ainvoke(initial, config=config)
        self._last_state = final.get("state", M.INITIAL_STATE)
        decision = final.get("decision")
        return ModerationDecision.model_validate(decision) if decision else None
