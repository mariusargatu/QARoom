from helpers import make_event, make_workflow
from moderator_agent.problem import ProblemError
from moderator_agent.schemas import LlmVerdict
from moderator_agent.workflow import model as M


def test_the_model_is_internally_consistent() -> None:
    states, events = set(M.STATES), set(M.EVENTS)
    for frm, event, to in M.TRANSITIONS:
        assert frm in states
        assert to in states
        assert event in events
    assert M.INITIAL_STATE in states
    assert M.TERMINAL_STATES <= states
    # A state name must never collide with an event name — the `PrecedentGathered` (state) vs
    # `PrecedentCollected` (event) split exists to keep these disjoint (ADR-0020 trajectory).
    assert states.isdisjoint(events)


def test_every_state_is_reachable_from_the_initial_state() -> None:
    reachable = {M.INITIAL_STATE}
    changed = True
    while changed:
        changed = False
        for frm, _event, to in M.TRANSITIONS:
            if frm in reachable and to not in reachable:
                reachable.add(to)
                changed = True
    assert reachable == set(M.STATES)


async def test_the_approve_path_emits_only_legal_transitions_in_order() -> None:
    sink: list[dict] = []
    workflow, _, _ = make_workflow(sink=sink)
    await workflow.run(make_event())
    for transition in sink:
        assert M.is_legal(transition["from"], transition["event"], transition["to"])
    assert [(t["from"], t["event"], t["to"]) for t in sink] == [
        ("Received", "ReviewRequested", "Retrieved"),
        ("Retrieved", "PolicyRetrieved", "PrecedentGathered"),
        ("PrecedentGathered", "PrecedentCollected", "Drafted"),
        ("Drafted", "DraftProduced", "SelfChecked"),
        ("SelfChecked", "SelfCheckPassed", "Recorded"),
    ]


class _FailingLlm:
    model = "fail-1"

    def classify(self, *, system_prompt: str, post_text: str) -> LlmVerdict:
        raise ProblemError(
            slug="llm-down", title="LLM unavailable", status=502, failure_domain="dependency_failure"
        )


class _FailingEmbedder:
    model = "fail-embed-1"

    def embed(self, text: str) -> list[float]:
        raise ProblemError(
            slug="embed-down", title="embed down", status=502, failure_domain="dependency_failure"
        )


class _FailingSimilarKnowledge:
    """An in-memory knowledge double whose precedent lookup fails (the gather_precedent dependency)."""

    async def rules_for(self, community_id: str):
        return []

    async def similar(self, community_id: str, embedding, *, limit: int = 3):
        raise ProblemError(
            slug="pgvector-down", title="similar down", status=502, failure_domain="dependency_failure"
        )

    async def remember(self, **kwargs) -> None:  # pragma: no cover - never reached on this path
        return None

    async def count_embeddings(self) -> int:
        return 0


class _FailingRecordStore:
    """A decision store whose record fails (the record dependency, at SelfChecked)."""

    async def record(self, decision) -> bool:
        raise ProblemError(
            slug="db-down", title="db down", status=502, failure_domain="dependency_failure"
        )

    async def find_by_event(self, community_id: str, event_id: str):
        return None

    async def list_for(self, community_id: str):
        return []

    async def get(self, community_id: str, decision_id: str):
        return None

    async def count(self) -> int:
        return 0


async def _failure_triples(**kwargs) -> list[tuple[str, str, str]]:
    sink: list[dict] = []
    workflow, _, _ = make_workflow(sink=sink, **kwargs)
    await workflow.run(make_event())
    for t in sink:
        assert M.is_legal(t["from"], t["event"], t["to"])
    return [(t["from"], t["event"], t["to"]) for t in sink]


async def test_a_retrieve_failure_emits_dependency_failed_from_received() -> None:
    assert ("Received", "DependencyFailed", "Failed") in await _failure_triples(
        embedder=_FailingEmbedder()
    )


async def test_a_precedent_failure_emits_dependency_failed_from_retrieved() -> None:
    assert ("Retrieved", "DependencyFailed", "Failed") in await _failure_triples(
        knowledge=_FailingSimilarKnowledge()  # type: ignore[arg-type]
    )


async def test_a_draft_failure_emits_dependency_failed_from_precedent_gathered() -> None:
    assert ("PrecedentGathered", "DependencyFailed", "Failed") in await _failure_triples(
        llm=_FailingLlm()
    )


async def test_a_record_failure_emits_dependency_failed_from_self_checked() -> None:
    assert ("SelfChecked", "DependencyFailed", "Failed") in await _failure_triples(
        decisions=_FailingRecordStore()  # type: ignore[arg-type]
    )
