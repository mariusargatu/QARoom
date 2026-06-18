"""Langfuse decision scoring as a free collaborator — lifted out of the workflow orchestrator.

The moderation trajectory in ``workflow/graph.py`` owns correctness; attaching a decision's outcome to
its Langfuse trace as scores (and routing an escalation into the human-annotation queue) is a
best-effort SIDE concern. Binding the (optional) client + queue id here keeps ``graph.py`` focused on
the graph and gives the four-score emission one home. Entirely best-effort: the client swallows
failures, so observability never affects the recorded decision.
"""

from __future__ import annotations

from .langfuse_integration import LangfuseClient, ScoreType, current_trace_id
from .schemas import ModerationDecision


class DecisionObserver:
    """Attaches a decision's outcome to its Langfuse trace. Built once in the workflow's ``__init__``,
    binding the (optional) client + queue id; a None/disabled client makes ``record`` a no-op."""

    def __init__(self, langfuse: LangfuseClient | None, *, queue_id: str | None = None) -> None:
        self._langfuse = langfuse
        self._queue_id = queue_id

    async def record(self, decision: ModerationDecision) -> None:
        langfuse = self._langfuse
        if langfuse is None or not langfuse.enabled:
            return
        trace_id = current_trace_id()
        if trace_id is None:
            return
        # The four scores differ only in (name, value, data_type) — drive them from data, not
        # copy-paste. Keep the int 1/0 for the BOOLEAN value to stay byte-identical to the prior emit.
        scores: list[tuple[str, float | str, ScoreType]] = [
            ("disposition", decision.disposition, "CATEGORICAL"),
            ("confidence", decision.confidence, "NUMERIC"),
            ("cited_rules", float(len(decision.cited_rules)), "NUMERIC"),
            ("departs_from_precedent", 1 if decision.departs_from_precedent else 0, "BOOLEAN"),
        ]
        for name, value, data_type in scores:
            await langfuse.create_score(
                trace_id=trace_id, name=name, value=value, data_type=data_type
            )
        if decision.disposition == "escalate_to_human" and self._queue_id is not None:
            await langfuse.add_queue_item(queue_id=self._queue_id, trace_id=trace_id)
