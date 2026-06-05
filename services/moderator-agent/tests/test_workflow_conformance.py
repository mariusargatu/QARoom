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


async def test_the_allow_path_emits_only_legal_transitions_in_order() -> None:
    sink: list[dict] = []
    workflow, _, _ = make_workflow(sink=sink)
    await workflow.run(make_event())
    for transition in sink:
        assert M.is_legal(transition["from"], transition["event"], transition["to"])
    assert [(t["from"], t["event"], t["to"]) for t in sink] == [
        ("Received", "ReviewRequested", "Retrieved"),
        ("Retrieved", "ContextRetrieved", "Classified"),
        ("Classified", "VerdictProduced", "Recorded"),
    ]


class _FailingLlm:
    model = "fail-1"

    def classify(self, *, system_prompt: str, post_text: str) -> LlmVerdict:
        raise ProblemError(
            slug="llm-down",
            title="LLM unavailable",
            status=502,
            failure_domain="dependency_failure",
        )


async def test_a_failure_emits_a_legal_dependency_failed_transition() -> None:
    sink: list[dict] = []
    workflow, _, _ = make_workflow(llm=_FailingLlm(), sink=sink)
    await workflow.run(make_event())
    triples = [(t["from"], t["event"], t["to"]) for t in sink]
    for transition in sink:
        assert M.is_legal(transition["from"], transition["event"], transition["to"])
    assert ("Retrieved", "DependencyFailed", "Failed") in triples
