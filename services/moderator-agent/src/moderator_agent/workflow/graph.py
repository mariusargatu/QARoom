"""The LangGraph runner over the moderation model (Milestone 9; re-scoped to RAG in M12, ADR-0020).

A real ``StateGraph`` — ``retrieve → gather_precedent → draft → self_check → record`` with a failure
edge to ``END`` — so the workflow IS the graph the README renders and the conformance test walks. The
trajectory is retrieval-grounded (FR2/FR6): ``retrieve`` fetches top-k policy from the corpus,
``gather_precedent`` similar past decisions, ``draft`` is the single LLM call (a citation-bearing
disposition), ``self_check`` is PURE validation (grounding + precedent + abstain — see ``selfcheck``),
and ``record`` persists + publishes. Each node records its transition into the run state AND emits an
``xstate.transition`` span (``telemetry.emit_transition_span``) with the same attributes the XState
services emit, so the Tracetest reverse-conformance assertion (ADR-0012) works unchanged. ``_advance``
asserts the emitted transition is legal per ``model.py`` and that it leaves the live state — so an
off-model emission fails fast at the node, not only in the one conformance test that walks that path.

Idempotency (Commitment 17) is the decision store's job, not the checkpointer's (unchanged from M9):
``run`` always supplies the full initial input, so a re-delivery re-invokes the graph from the start;
``record`` returns ``is_new=False`` on a duplicate ``event_id`` and the republish carries a stable,
decision-derived Msg-Id, so the duplicate is observably a no-op downstream (ADR-0018).
"""

from __future__ import annotations

import asyncio
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from opentelemetry import trace as _otel_trace

from .. import telemetry
from ..config import Settings
from ..decision_observer import DecisionObserver
from ..determinism import Clock, IdGenerator
from ..guard import guard_post_text
from ..lamport import LamportGate
from ..langfuse_integration import LangfuseClient
from ..llm import Embedder, LlmClient
from ..ports import DecisionStore, EventPublisher, KnowledgeStore, PolicyCorpusStore
from ..problem import ProblemError
from ..rerank import Reranker
from ..schemas import (
    LlmVerdict,
    ModerationDecision,
    PolicyEntry,
    PostCreatedEvent,
    iso_z,
)
from ..subjects import (
    MODERATION_DECISION_RECORDED_EVENT,
    MODERATION_DECISION_RECORDED_VERSION,
    moderation_decision_recorded,
)
from . import model as M
from . import selfcheck
from .prompts import build_system_prompt, static_system_instructions


class WorkflowState(TypedDict, total=False):
    event: dict
    policy: list[dict]
    precedents: list[str]
    embedding: list[float]
    # `verdict` carries the drafted LlmVerdict out of `draft`, then the self-checked one out of
    # `self_check` — one key, since the raw draft is never read after self-check validates it.
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
        reranker: Reranker,
        knowledge: KnowledgeStore,
        corpus: PolicyCorpusStore,
        decisions: DecisionStore,
        clock: Clock,
        ids: IdGenerator,
        lamport: LamportGate,
        settings: Settings,
        publisher: EventPublisher | None = None,
        checkpointer: Any = None,
        sink: list[dict] | None = None,
        langfuse: LangfuseClient | None = None,
        langfuse_queue_id: str | None = None,
    ) -> None:
        self._llm = llm
        self._embedder = embedder
        self._reranker = reranker
        self._knowledge = knowledge
        self._corpus = corpus
        self._decisions = decisions
        self._clock = clock
        self._ids = ids
        self._lamport = lamport
        self._settings = settings
        self._publisher = publisher
        self._sink = sink
        # Best-effort LLM-observability sink (Langfuse). None/disabled → the agent runs unchanged.
        # `_draft` still reads `self._langfuse` for the live prompt; the decision-scoring side-concern
        # is bound once into a DecisionObserver so the orchestrator stays focused on the trajectory.
        self._langfuse = langfuse
        self._observer = DecisionObserver(langfuse, queue_id=langfuse_queue_id)
        self._last_state = M.INITIAL_STATE
        self._graph = self._build(checkpointer)

    @property
    def last_state(self) -> str:
        return self._last_state

    def _build(self, checkpointer: Any) -> Any:
        graph: StateGraph = StateGraph(WorkflowState)
        graph.add_node("retrieve", self._retrieve)
        graph.add_node("rerank", self._rerank)
        graph.add_node("gather_precedent", self._gather_precedent)
        graph.add_node("draft", self._draft)
        graph.add_node("self_check", self._self_check)
        graph.add_node("record", self._record)
        graph.add_edge(START, "retrieve")
        graph.add_conditional_edges("retrieve", self._route, {"continue": "rerank", "failed": END})
        graph.add_conditional_edges(
            "rerank", self._route, {"continue": "gather_precedent", "failed": END}
        )
        graph.add_conditional_edges(
            "gather_precedent", self._route, {"continue": "draft", "failed": END}
        )
        graph.add_conditional_edges("draft", self._route, {"continue": "self_check", "failed": END})
        graph.add_conditional_edges(
            "self_check", self._route, {"continue": "record", "failed": END}
        )
        graph.add_edge("record", END)
        return graph.compile(checkpointer=checkpointer)

    @staticmethod
    def _route(state: WorkflowState) -> str:
        return "failed" if state.get("state") == "Failed" else "continue"

    def _advance(
        self, state: WorkflowState, updates: dict, *, frm: str, event: str, to: str
    ) -> dict:
        # Fail fast on an off-model emission (a copy-paste of the wrong event, or a node whose `frm`
        # has drifted from the live state) — the model in model.py is the sole authority (ADR-0012).
        if not M.is_legal(frm, event, to):
            raise RuntimeError(f"off-model transition: ({frm!r}, {event!r}, {to!r}) not in model")
        current = state.get("state", M.INITIAL_STATE)
        if current != frm:
            raise RuntimeError(f"transition from {frm!r} but live state is {current!r}")
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
        """Embed the post and retrieve a WIDE candidate set (stage 1 of two-stage retrieval, ADR-0021).
        The rerank node narrows it to top-k; here we cast the net by cosine. Failure → Failed@Received."""
        event = PostCreatedEvent.model_validate(state["event"])
        try:
            embedding = await asyncio.to_thread(self._embedder.embed, self._post_text(event))
            policy = await self._corpus.retrieve(
                event.community_id, embedding, limit=self._settings.moderator_retrieval_candidates
            )
        except ProblemError:
            return self._fail(state, frm="Received")
        return self._advance(
            state,
            {"policy": [e.model_dump() for e in policy], "embedding": embedding},
            frm="Received",
            event="ReviewRequested",
            to="Retrieved",
        )

    async def _rerank(self, state: WorkflowState) -> dict:
        """Stage 2: rerank the candidates to the top-k the draft reasons over (ADR-0021). The reranker
        is grounding-guarded (output ⊆ candidates), so this narrows but never fabricates policy.
        Failure → Failed@Retrieved."""
        event = PostCreatedEvent.model_validate(state["event"])
        candidates = [PolicyEntry.model_validate(e) for e in state.get("policy", [])]
        try:
            ranked = await asyncio.to_thread(
                self._reranker.rerank,
                self._post_text(event),
                candidates,
                top_k=self._settings.moderator_retrieval_limit,
            )
        except ProblemError:
            return self._fail(state, frm="Retrieved")
        return self._advance(
            state,
            {"policy": [e.model_dump() for e in ranked]},
            frm="Retrieved",
            event="CandidatesReranked",
            to="Reranked",
        )

    async def _gather_precedent(self, state: WorkflowState) -> dict:
        """Gather similar past decisions as precedent (FR4). Failure → Failed@Reranked."""
        event = PostCreatedEvent.model_validate(state["event"])
        try:
            precedents = await self._knowledge.similar(
                event.community_id, state.get("embedding", [])
            )
        except ProblemError:
            return self._fail(state, frm="Reranked")
        return self._advance(
            state,
            {"precedents": precedents},
            frm="Reranked",
            event="PolicyRetrieved",
            to="PrecedentGathered",
        )

    async def _draft(self, state: WorkflowState) -> dict:
        """The single LLM call: draft a citation-bearing disposition from the retrieved context
        (FR3). The untrusted post body AND the attacker-reachable retrieved context (policy + precedent)
        are fenced by the injection guards. Failure → Failed@PrecedentGathered."""
        event = PostCreatedEvent.model_validate(state["event"])
        entries = [PolicyEntry.model_validate(e) for e in state.get("policy", [])]
        bug = self._settings.moderator_prompt_bug
        # The static instruction block is live-editable in Langfuse; fall back to the hardcoded block
        # when Langfuse is off/unreachable. The deliberate-bug variant bypasses Langfuse (it is a test
        # toggle, not a tuned prompt). The dynamic retrieved policy is appended either way.
        fallback_header = static_system_instructions(prompt_bug=bug)
        if self._langfuse is not None and not bug:
            header = await self._langfuse.get_prompt_text(
                self._settings.langfuse_prompt_name, fallback=fallback_header
            )
        else:
            header = fallback_header
        prompt = build_system_prompt(
            entries,
            state.get("precedents", []),
            prompt_bug=bug,
            header=header,
            corpus_guard_disabled=self._settings.moderator_disable_corpus_guard,
        )
        guarded = guard_post_text(
            self._post_text(event), disabled=self._settings.moderator_disable_input_guard
        )
        try:
            draft = await asyncio.to_thread(
                self._llm.classify, system_prompt=prompt, post_text=guarded
            )
        except ProblemError:
            return self._fail(state, frm="PrecedentGathered")
        return self._advance(
            state,
            {"verdict": draft.model_dump()},
            frm="PrecedentGathered",
            event="PrecedentCollected",
            to="Drafted",
        )

    async def _self_check(self, state: WorkflowState) -> dict:
        """PURE validation: ground the draft's citations, flag precedent departure, abstain on low
        confidence / ungrounded removal (FR3/FR4/FR5). No I/O, so no failure edge — see model.py."""
        draft = LlmVerdict.model_validate(state["verdict"])
        retrieved_ids = [e["entry_id"] for e in state.get("policy", [])]
        verdict = selfcheck.self_check(
            draft,
            retrieved_ids,
            state.get("precedents", []),
            abstain_confidence=self._settings.moderator_abstain_confidence,
            ungrounded=self._settings.moderator_ungrounded,
            disable_abstain=self._settings.moderator_disable_abstain,
            disable_approve_guard=self._settings.moderator_disable_approve_guard,
        )
        return self._advance(
            state,
            {"verdict": verdict.model_dump()},
            frm="Drafted",
            event="DraftProduced",
            to="SelfChecked",
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
            disposition=verdict.disposition,
            cited_rules=verdict.cited_rules,
            precedents=verdict.precedents,
            departs_from_precedent=verdict.departs_from_precedent,
            rationale=verdict.rationale,
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
            return self._fail(state, frm="SelfChecked")
        # Publish on EVERY delivery, OUTSIDE the dedup guard and the ProblemError catch. The Msg-Id is
        # derived from the decision id, so a republish (the safety net when no checkpoint suppressed a
        # duplicate) is dropped downstream by JetStream's duplicate_window + the consumer's dedup. A
        # publish failure is NOT a ProblemError: it propagates → the consumer naks → redelivery
        # re-attempts the publish. This is the outbox-free at-least-once guarantee (ADR-0018).
        await self._publish(decision)
        await self._observer.record(decision)
        return self._advance(
            state,
            {"decision": decision.model_dump()},
            frm="SelfChecked",
            event="SelfCheckPassed",
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
        # Set Langfuse trace-level fields on the ROOT span (active here, before the LangGraph child
        # spans): session = community (tenant grouping), a clean name, and the post as the trace input
        # so the trace card shows post → disposition instead of null/undefined. No-op when tracing off.
        span = _otel_trace.get_current_span()
        span.set_attribute("langfuse.session.id", event.community_id)
        span.set_attribute("langfuse.trace.name", "moderate-post")
        span.set_attribute("langfuse.trace.tags", ["moderation"])
        span.set_attribute("langfuse.trace.input", self._post_text(event))
        config: dict = {"configurable": {"thread_id": event.event_id}}
        final = await self._graph.ainvoke(initial, config=config)
        self._last_state = final.get("state", M.INITIAL_STATE)
        decision = final.get("decision")
        result = ModerationDecision.model_validate(decision) if decision else None
        if result is not None:
            span.set_attribute("langfuse.trace.output", f"{result.disposition}: {result.rationale}")
        return result
