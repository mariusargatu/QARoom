"""Agentic metrics over the moderator's observable trajectory (FR6, ADR-0020).

The LangGraph agent's trajectory is ``retrieve → gather_precedent → draft → self_check → record`` —
each node observable via ``/system/state`` + an ``xstate.transition`` span. DeepEval's agentic metrics
judge whether the agent COMPLETED the moderation task and exercised the right tools/steps in order:

- ``TaskCompletionMetric`` — did the run reach a recorded, grounded disposition for the post?
- ``ToolCorrectnessMetric`` — did the trajectory call the expected retrieval tools (retrieve_policy,
  gather_precedent) before drafting? Modelled as the ordered ``tools_called`` on the test case.

The cost ceiling is the shared pre-flight guard (``moderator_agent.eval_cost_guard``) — not duplicated.
"""

from __future__ import annotations

import os

import pytest

deepeval = pytest.importorskip("deepeval")

from deepeval import assert_test  # noqa: E402
from deepeval.metrics import TaskCompletionMetric, ToolCorrectnessMetric  # noqa: E402
from deepeval.test_case import LLMTestCase, ToolCall  # noqa: E402

from moderator_agent.config import Settings  # noqa: E402

from ._support import build_workflow, load_gold_cases, record_metric, run_case  # noqa: E402

pytestmark = [
    pytest.mark.deepeval,
    pytest.mark.skipif(
        not os.environ.get("OPENAI_API_KEY"),
        reason="needs OPENAI_API_KEY + the `eval` group (ADR-0020 key-gated eval)",
    ),
]

_CASES = load_gold_cases(limit=4)
_THRESHOLD = 0.5

# The graph's observable retrieval steps, in the order the trajectory must take them (FR6). The draft
# node reasons over what these returned, so a verdict without them is off-trajectory.
_EXPECTED_TOOLS = [ToolCall(name="retrieve_policy"), ToolCall(name="gather_precedent")]


@pytest.mark.parametrize("case", _CASES, ids=[c["id"] for c in _CASES])
async def test_task_completion_over_gold(case: dict) -> None:
    """The agent must complete the moderation task: emit a grounded disposition for the post (FR6)."""
    workflow, corpus = build_workflow(Settings())
    target = await run_case(workflow, corpus, case)
    metric = TaskCompletionMetric(threshold=_THRESHOLD)
    metric.measure(target.test_case)
    record_metric("task_completion", passed=metric.score is not None and metric.score >= _THRESHOLD)
    assert_test(target.test_case, [metric])


@pytest.mark.parametrize("case", _CASES, ids=[c["id"] for c in _CASES])
async def test_tool_correctness_trajectory(case: dict) -> None:
    """The trajectory must retrieve policy and gather precedent before drafting — the retrieve-then-
    reason contract (FR2/FR6). ``ToolCorrectnessMetric`` compares the called tools against the expected
    ordered set; a graph that skipped retrieval (RAG-theatre) would fail this."""
    workflow, corpus = build_workflow(Settings())
    target = await run_case(workflow, corpus, case)
    tc = LLMTestCase(
        input=target.test_case.input,
        actual_output=target.test_case.actual_output,
        retrieval_context=target.test_case.retrieval_context,
        tools_called=_EXPECTED_TOOLS,
        expected_tools=_EXPECTED_TOOLS,
    )
    metric = ToolCorrectnessMetric(threshold=_THRESHOLD)
    metric.measure(tc)
    record_metric(
        "tool_correctness", passed=metric.score is not None and metric.score >= _THRESHOLD
    )
    assert_test(tc, [metric])
