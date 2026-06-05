import pytest
from langgraph.checkpoint.memory import MemorySaver

from helpers import CountingLlm, RecordingPublisher, make_event, make_workflow
from moderator_agent.persistence.memory import InMemoryDecisionStore
from moderator_agent.problem import ProblemError
from moderator_agent.schemas import LlmVerdict


async def test_a_benign_post_is_allowed_and_recorded() -> None:
    publisher = RecordingPublisher()
    workflow, decisions, _ = make_workflow(publisher=publisher)
    decision = await workflow.run(make_event())
    assert decision is not None
    assert decision.verdict == "allow"
    assert workflow.last_state == "Recorded"
    assert await decisions.count() == 1
    assert len(publisher.published) == 1


async def test_a_rule_violating_post_is_flagged_with_the_rule_id() -> None:
    workflow, _, _ = make_workflow()
    decision = await workflow.run(make_event(body="you are an idiot and nobody wants you here"))
    assert decision is not None
    assert decision.verdict == "flag"
    assert decision.rule_id == "no-harassment"


async def test_a_duplicate_event_id_is_idempotent() -> None:
    publisher = RecordingPublisher()
    workflow, decisions, _ = make_workflow(publisher=publisher)
    first = await workflow.run(make_event())
    second = await workflow.run(make_event())
    assert first is not None and second is not None
    assert first.decision_id == second.decision_id  # the stored decision, not a fresh mdec_
    assert await decisions.count() == 1  # recorded exactly once
    # The safety-net republish (no checkpoint suppressed this duplicate) carries a STABLE Msg-Id, so
    # downstream dedups it rather than seeing two distinct events (ADR-0018).
    assert len(publisher.published) == 2
    assert publisher.published[0]["event_id"] == publisher.published[1]["event_id"]


async def test_the_published_event_id_is_stable_and_derived_from_the_decision() -> None:
    publisher = RecordingPublisher()
    workflow, _, _ = make_workflow(publisher=publisher)
    decision = await workflow.run(make_event())
    assert decision is not None
    assert publisher.published[0]["event_id"] == "evt_" + decision.decision_id.split("_", 1)[1]


class _FailingPublisher:
    async def publish(self, **kwargs: object) -> None:
        raise RuntimeError("nats unavailable")


async def test_a_publish_failure_propagates_so_the_consumer_naks() -> None:
    # The decision is durably recorded, but a publish failure must PROPAGATE (not be swallowed) so the
    # consumer naks and redelivery re-publishes with the stable Msg-Id — outbox-free at-least-once.
    workflow, decisions, _ = make_workflow(publisher=_FailingPublisher())
    with pytest.raises(RuntimeError):
        await workflow.run(make_event())
    assert await decisions.count() == 1


class _FailingLlm:
    model = "fail-1"

    def classify(self, *, system_prompt: str, post_text: str) -> LlmVerdict:
        raise ProblemError(
            slug="llm-down",
            title="LLM unavailable",
            status=502,
            failure_domain="dependency_failure",
            retryable=True,
        )


async def test_a_dependency_failure_records_no_decision() -> None:
    workflow, decisions, _ = make_workflow(llm=_FailingLlm())
    decision = await workflow.run(make_event())
    assert decision is None
    assert workflow.last_state == "Failed"
    assert await decisions.count() == 0


class _FailsOncePublisher:
    def __init__(self) -> None:
        self.published: list[dict] = []

    async def publish(self, **kwargs: object) -> None:
        self.published.append(dict(kwargs))
        if len(self.published) == 1:
            raise RuntimeError("transient broker failure")


async def test_a_publish_failure_then_redelivery_republishes_the_same_msg_id() -> None:
    # The outbox-free at-least-once recovery path (ADR-0018): first delivery records the decision but
    # the publish fails (propagates → consumer naks); redelivery reuses the STORED decision and
    # republishes the SAME Msg-Id, so downstream dedups it. Recorded exactly once throughout.
    publisher = _FailsOncePublisher()
    workflow, decisions, _ = make_workflow(publisher=publisher)
    with pytest.raises(RuntimeError, match="transient broker failure"):
        await workflow.run(make_event())
    assert await decisions.count() == 1
    first = (await decisions.list_for(make_event().community_id))[0]

    decision = await workflow.run(make_event())
    assert decision is not None
    assert decision.decision_id == first.decision_id  # the stored decision, not a fresh mdec_
    assert await decisions.count() == 1
    assert len(publisher.published) == 2
    assert publisher.published[0]["event_id"] == publisher.published[1]["event_id"]


class _AmnesiacStore(InMemoryDecisionStore):
    """Reports a duplicate (``record`` → False) yet has no record of it (``find_by_event`` → None) —
    the broken ON CONFLICT invariant the fail-fast guard exists for."""

    async def record(self, decision) -> bool:  # type: ignore[override]
        return False

    async def find_by_event(self, community_id: str, event_id: str):
        return None


async def test_a_lost_decision_on_a_duplicate_fails_fast_rather_than_diverging() -> None:
    # If a duplicate is reported but the original cannot be retrieved, the workflow must NOT silently
    # republish under a fresh (divergent) Msg-Id — it fails (Failed state), surfacing the invariant.
    publisher = RecordingPublisher()
    workflow, _, _ = make_workflow(decisions=_AmnesiacStore(), publisher=publisher)
    decision = await workflow.run(make_event())
    assert decision is None
    assert workflow.last_state == "Failed"
    assert publisher.published == []  # nothing republished under a wrong id


@pytest.mark.parametrize(
    "make_checkpointer",
    [lambda: None, lambda: MemorySaver()],
    ids=["no-checkpointer", "with-checkpointer"],
)
async def test_idempotency_is_the_stores_job_not_the_checkpointers(make_checkpointer) -> None:
    # run() always supplies the full initial input, so a re-delivery re-invokes the graph (a SECOND
    # classify) whether or not a checkpointer is wired — LangGraph only resumes when invoked with
    # None. Asserting IDENTICAL behavior both ways pins that the unique event_id + stable Msg-Id, NOT
    # the checkpointer, are what make a duplicate observably a no-op (ADR-0018). If a future change
    # made idempotency depend on the checkpointer, the no-checkpointer case would break.
    llm = CountingLlm()
    publisher = RecordingPublisher()
    workflow, decisions, _ = make_workflow(
        llm=llm, publisher=publisher, checkpointer=make_checkpointer()
    )
    first = await workflow.run(make_event())
    second = await workflow.run(make_event())
    assert first is not None and second is not None
    assert llm.calls == 2  # re-delivery re-classifies regardless of the checkpointer
    assert first.decision_id == second.decision_id  # store dedup made it observably idempotent
    assert await decisions.count() == 1
    assert publisher.published[0]["event_id"] == publisher.published[1]["event_id"]
