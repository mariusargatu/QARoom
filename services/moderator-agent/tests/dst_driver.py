"""Seeded fault stubs + the driver that fuzzes the REAL ``ModerationWorkflow`` (T21).

The primitives + oracles are in ``dst_harness``; this is the half that wires a seeded scenario into
the actual agent: a scripted inference backend, in-memory I/O fakes that fail on cue, a backoff
spinner on the virtual clock, and the off-graph "tool call" falsifier. ``run_trajectory(seed)`` builds
the real graph with these stubs, runs it, and returns the observable ``TrajectoryResult`` the oracles
judge. Every fault below drives the run down a LEGAL edge of ``model.py`` (a ``DependencyFailed`` to
``Failed``, or an escalation that still ``Recorded``s) — so a healthy agent holds safety + liveness
across every seed; the off-graph + spinner injections are the deliberate falsifiers that must turn an
oracle red.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from dst_harness import EntropyBuffer, LivelockDetected, TrajectoryResult, VirtualClock
from helpers import AUTHOR, COMMUNITY, DEFAULT_RULES, POST, make_corpus
from moderator_agent.config import Settings
from moderator_agent.determinism import seeded_trio
from moderator_agent.lamport import LamportGate
from moderator_agent.llm import ZeroEmbedder
from moderator_agent.persistence.memory import (
    InMemoryDecisionStore,
    InMemoryKnowledgeStore,
    InMemoryPolicyCorpusStore,
)
from moderator_agent.problem import ProblemError
from moderator_agent.rerank import IdentityReranker
from moderator_agent.schemas import (
    Disposition,
    LlmVerdict,
    ModerationDecision,
    PostCreatedEvent,
    iso_z,
)
from moderator_agent.telemetry import emit_transition_span
from moderator_agent.workflow import model as M
from moderator_agent.workflow.graph import ModerationWorkflow

# Faults the entropy buffer draws over — each maps to a LEGAL trajectory (a DependencyFailed edge, or
# an escalation that still records). `none` is the clean path.
FAULT_KINDS = (
    "none",
    "embed_fail",  # retrieve dependency down  -> Failed@Received
    "rerank_fail",  # rerank dependency down    -> Failed@Retrieved
    "precedent_fail",  # precedent lookup down  -> Failed@Reranked
    "record_fail",  # decision store down       -> Failed@SelfChecked
    "llm_refusal",  # draft refuses/parse-fails -> Failed@PrecedentGathered
    "low_confidence",  # draft below abstain    -> Recorded (escalate_to_human)
    "empty_retrieval",  # corpus returns []     -> Recorded (grounded down to escalate/approve)
)
DRAFT_DISPOSITIONS = ("approve", "remove", "escalate_to_human")
RULE_CHOICES = ("", "no-harassment", "no-spam")  # "" -> the draft cites nothing
BODY_VARIANTS = ("benign", "harassing", "spammy", "ambiguous")
_BODIES = {
    "benign": "A warm welcome to the community.",
    "harassing": "you are an idiot and a stupid person",
    "spammy": "BUY NOW cheap deals at my-site.example",
    "ambiguous": "this could mean anything depending on context",
}

# The off-graph "tool call" the AGENT_OFF_GRAPH_TOOL_CALL falsifier injects: a jump straight from
# Drafted to Recorded that SKIPS the self_check safety node. It is not in `model.TRANSITIONS`, so the
# safety oracle reds on it — exactly the "agent took an action outside the allowed graph" bug class.
OFF_GRAPH_FROM = "Drafted"
OFF_GRAPH_EVENT = "AgentToolCall"
OFF_GRAPH_TO = "Recorded"


def _dependency_down(slug: str, title: str) -> ProblemError:
    return ProblemError(
        slug=slug, title=title, status=502, failure_domain="dependency_failure", retryable=True
    )


@dataclass(frozen=True)
class Scenario:
    seed: int
    fault: str
    draft_disposition: str
    draft_confidence: float
    cited_rule: str | None
    body: str
    off_graph: bool
    spinner: str  # "off" | "uncapped" | "capped"


def draw_scenario(
    entropy: EntropyBuffer, *, faults: bool, off_graph: bool, spinner: str
) -> Scenario:
    """Draw one run's faults + response variant from the seed. When a spinner is planted we hold the
    other faults at `none` so the spin is the sole deviation (a clean isolation of the liveness teeth)."""
    fault = entropy.choice(FAULT_KINDS) if (faults and spinner == "off") else "none"
    disposition = entropy.choice(DRAFT_DISPOSITIONS)
    # A clean draft is confident (>= the 0.5 abstain floor); `low_confidence` overrides this to 0.2.
    confidence = round(0.5 + 0.49 * entropy.unit(), 3)
    cited = entropy.choice(RULE_CHOICES)
    body = entropy.choice(BODY_VARIANTS)
    return Scenario(
        seed=entropy.seed,
        fault=fault,
        draft_disposition=disposition,
        draft_confidence=confidence,
        cited_rule=cited or None,
        body=body,
        off_graph=off_graph,
        spinner=spinner,
    )


class ScriptedLlm:
    """Deterministic inference backend: the draft is read from the scenario, not a network. Models the
    fault response variants — a refusal (no structured output) and a low-confidence draft."""

    def __init__(self, scenario: Scenario) -> None:
        self._scenario = scenario

    @property
    def model(self) -> str:
        return "dst-scripted-1"

    def classify(self, *, system_prompt: str, post_text: str) -> LlmVerdict:
        scenario = self._scenario
        if scenario.fault == "llm_refusal":
            raise _dependency_down("llm-refusal", "LLM returned no structured output")
        confidence = 0.2 if scenario.fault == "low_confidence" else scenario.draft_confidence
        cited = [scenario.cited_rule] if scenario.cited_rule else []
        return LlmVerdict(
            disposition=cast(Disposition, scenario.draft_disposition),
            cited_rules=cited,
            precedents=[],
            departs_from_precedent=False,
            rationale="scripted draft",
            confidence=confidence,
        )


class FailingEmbedder:
    @property
    def model(self) -> str:
        return "dst-fail-embed"

    def embed(self, text: str) -> list[float]:
        raise _dependency_down("embedding-unavailable", "embedding down")


class FailingReranker:
    name = "dst-fail-rerank"

    def rerank(self, query, entries, *, top_k):  # type: ignore[no-untyped-def]
        raise _dependency_down("rerank-unavailable", "rerank down")


class FailingKnowledge:
    async def rules_for(self, community_id: str) -> list:
        return []

    async def similar(self, community_id: str, embedding, *, limit: int = 3) -> list[str]:
        raise _dependency_down("pgvector-down", "precedent lookup down")

    async def remember(self, **kwargs) -> None:  # pragma: no cover - never reached on this path
        return None

    async def count_embeddings(self) -> int:
        return 0


class FailingDecisionStore:
    async def record(self, decision: ModerationDecision) -> bool:
        raise _dependency_down("db-down", "decision store down")

    async def find_by_event(self, community_id: str, event_id: str):
        return None

    async def list_for(self, community_id: str) -> list:
        return []

    async def get(self, community_id: str, decision_id: str):
        return None

    async def count(self) -> int:
        return 0


class BackoffSpinner:
    """Models a node retrying a never-succeeding dependency with capped-jittered backoff (the same
    contract the webhooks edge ships). CAPPED → it gives up and declares the dependency down (a legal
    DependencyFailed). UNCAPPED → it retries forever: the planted infinite-spinner the virtual clock
    fast-forwards past the deadline and the liveness oracle catches."""

    def __init__(
        self,
        vclock: VirtualClock,
        entropy: EntropyBuffer,
        *,
        cap: int | None,
        base: float = 1.0,
        ceiling: float = 8.0,
    ) -> None:
        self._vclock = vclock
        self._entropy = entropy
        self._cap = cap
        self._base = base
        self._ceiling = ceiling

    async def run(self) -> None:
        attempt = 0
        while self._cap is None or attempt < self._cap:
            backoff = min(self._ceiling, self._base * (2**attempt))
            jitter = backoff * self._entropy.unit()
            await self._vclock.sleep(backoff + jitter)  # raises LivelockDetected past the deadline
            attempt += 1
        raise _dependency_down("precedent-exhausted", "precedent retries exhausted")


class SpinningKnowledge:
    """A knowledge store whose precedent lookup spins on the backoff loop instead of returning — the
    planted livelock lives at the gather_precedent node."""

    def __init__(self, spinner: BackoffSpinner) -> None:
        self._spinner = spinner

    async def rules_for(self, community_id: str) -> list:
        return []

    async def similar(self, community_id: str, embedding, *, limit: int = 3) -> list[str]:
        await self._spinner.run()
        return []  # pragma: no cover - unreachable when uncapped (the spinner never returns)

    async def remember(self, **kwargs) -> None:  # pragma: no cover
        return None

    async def count_embeddings(self) -> int:
        return 0


def inject_off_graph_tool_call(
    sink: list[dict], *, agent_id: str, session_id: str, at: str
) -> dict:
    """Record an OFF-GRAPH transition through the SAME telemetry sink + span channel the workflow
    uses — modelling an agent that fired a tool call outside the allowed graph. The triple is illegal
    per ``model.py``, so ``check_safety`` reds. This is the executable falsifier mechanism for the
    ``agent-trajectory-on-model`` claim (its manifest card is registered separately, T05-full)."""
    transition = {
        "from": OFF_GRAPH_FROM,
        "event": OFF_GRAPH_EVENT,
        "to": OFF_GRAPH_TO,
        "at": at,
        "agent_id": agent_id,
        "session_id": session_id,
    }
    emit_transition_span(
        machine=M.MACHINE,
        frm=OFF_GRAPH_FROM,
        to=OFF_GRAPH_TO,
        event=OFF_GRAPH_EVENT,
        at=at,
        agent_id=agent_id,
        session_id=session_id,
    )
    sink.append(transition)
    return transition


class OffGraphKnowledge:
    """Wraps a knowledge store; on the precedent lookup it ALSO fires the off-graph tool call into the
    shared sink, then delegates. The legal trajectory is unchanged — the run still reaches Recorded —
    but the sink now carries one illegal transition, so this is a SAFETY (not liveness) falsifier."""

    def __init__(self, inner, *, sink: list[dict], agent_id: str, session_id: str, at: str) -> None:
        self._inner = inner
        self._sink = sink
        self._agent_id = agent_id
        self._session_id = session_id
        self._at = at

    async def rules_for(self, community_id: str) -> list:
        return await self._inner.rules_for(community_id)

    async def similar(self, community_id: str, embedding, *, limit: int = 3) -> list[str]:
        inject_off_graph_tool_call(
            self._sink, agent_id=self._agent_id, session_id=self._session_id, at=self._at
        )
        return await self._inner.similar(community_id, embedding, limit=limit)

    async def remember(self, **kwargs) -> None:
        await self._inner.remember(**kwargs)

    async def count_embeddings(self) -> int:
        return await self._inner.count_embeddings()


def _make_event(scenario: Scenario) -> PostCreatedEvent:
    return PostCreatedEvent(
        event_id=f"evt_{str(scenario.seed).rjust(26, '0')}",
        post_id=POST,
        community_id=COMMUNITY,
        author_id=AUTHOR,
        title="DST review",
        body=_BODIES[scenario.body],
        created_at="2026-06-04T00:00:00.000Z",
    )


def _build_workflow(
    scenario: Scenario,
    sink: list[dict],
    vclock: VirtualClock,
    entropy: EntropyBuffer,
    event: PostCreatedEvent,
) -> ModerationWorkflow:
    clock, ids, _ = seeded_trio()
    settings = Settings()
    embedder = FailingEmbedder() if scenario.fault == "embed_fail" else ZeroEmbedder()
    reranker = FailingReranker() if scenario.fault == "rerank_fail" else IdentityReranker()
    decisions = (
        FailingDecisionStore() if scenario.fault == "record_fail" else InMemoryDecisionStore()
    )
    corpus = InMemoryPolicyCorpusStore() if scenario.fault == "empty_retrieval" else make_corpus()

    if scenario.spinner != "off":
        cap = None if scenario.spinner == "uncapped" else 3
        knowledge: object = SpinningKnowledge(BackoffSpinner(vclock, entropy, cap=cap))
    elif scenario.fault == "precedent_fail":
        knowledge = FailingKnowledge()
    else:
        base = InMemoryKnowledgeStore()
        base.set_rules(COMMUNITY, DEFAULT_RULES)
        knowledge = base

    if scenario.off_graph:
        knowledge = OffGraphKnowledge(
            knowledge,
            sink=sink,
            agent_id=M.MACHINE,
            session_id=event.event_id,
            at=iso_z(clock.now()),
        )

    return ModerationWorkflow(
        llm=ScriptedLlm(scenario),
        embedder=embedder,  # type: ignore[arg-type]
        reranker=reranker,  # type: ignore[arg-type]
        knowledge=knowledge,  # type: ignore[arg-type]
        corpus=corpus,
        decisions=decisions,  # type: ignore[arg-type]
        clock=clock,
        ids=ids,
        lamport=LamportGate(ids),
        settings=settings,
        publisher=None,
        sink=sink,
    )


async def run_trajectory(
    seed: int,
    *,
    faults: bool = True,
    off_graph: bool = False,
    spinner: str = "off",
    deadline: float = 30.0,
) -> TrajectoryResult:
    """Drive one seeded simulation of the real agent trajectory and return its observable outcome."""
    entropy = EntropyBuffer(seed)
    scenario = draw_scenario(entropy, faults=faults, off_graph=off_graph, spinner=spinner)
    vclock = VirtualClock(deadline=deadline)
    sink: list[dict] = []
    event = _make_event(scenario)
    workflow = _build_workflow(scenario, sink, vclock, entropy, event)

    livelock_detected = False
    decision: ModerationDecision | None = None
    try:
        decision = await workflow.run(event)
    except LivelockDetected:
        livelock_detected = True

    return TrajectoryResult(
        seed=seed,
        transitions=tuple(sink),
        final_state=workflow.last_state,
        disposition=decision.disposition if decision else None,
        decision=decision,
        virtual_elapsed=vclock.elapsed,
        livelock_detected=livelock_detected,
        fault=scenario.fault,
    )
