"""Custom G-Eval metrics + the RAGAS-via-DeepEval demonstration (FR4/FR5, ADR-0020).

Two ``GEval`` metrics encode QARoom-specific judgements no off-the-shelf metric covers:

- **precedent-consistency (FR4)** — the verdict is consistent with the retrieved precedent for similar
  content, or it sets ``departs_from_precedent`` with a reason. A silent divergence fails.
- **calibration / should-have-abstained (FR5)** — on low retrieval confidence or conflicting rules the
  agent must ``escalate_to_human`` rather than guess. A confident verdict on an ambiguous post fails.

The RAGAS demonstration: ONE test runs DeepEval's ``RAGASMetric`` wrapper, proving the RAGAS technique
is available WITHOUT a separate framework dependency. Per ADR-0020, RAGAS did not earn a parallel
install — DeepEval re-implemented its RAG metrics natively and wraps the rest, so this single named
eval is the entire RAGAS surface. The cost ceiling is the shared pre-flight guard
(``moderator_agent.eval_cost_guard``) — not duplicated here.
"""

from __future__ import annotations

import os

import pytest

deepeval = pytest.importorskip("deepeval")

from deepeval import assert_test  # noqa: E402
from deepeval.metrics import GEval  # noqa: E402
from deepeval.test_case import LLMTestCase, LLMTestCaseParams  # noqa: E402

from moderator_agent.config import Settings  # noqa: E402

from ._support import (  # noqa: E402
    build_workflow,
    load_ambiguous_cases,
    load_gold_cases,
    record_metric,
    run_case,
)

pytestmark = [
    pytest.mark.deepeval,
    pytest.mark.skipif(
        not os.environ.get("OPENAI_API_KEY"),
        reason="needs OPENAI_API_KEY + the `eval` group (ADR-0020 key-gated eval)",
    ),
]

_CASES = load_gold_cases(limit=4)
# The held-out AMBIGUOUS cases (non-unanimous SMEs) are the calibration target: a well-calibrated
# agent abstains on these rather than guessing — the only place the gold set deliberately disagrees.
_AMBIGUOUS = load_ambiguous_cases(limit=3)
_THRESHOLD = 0.5


def _precedent_consistency_metric() -> GEval:
    return GEval(
        name="precedent-consistency",
        criteria=(
            "Given the retrieval context (which includes similar past decisions as precedent), the "
            "verdict in actual_output is precedent-consistent if it either agrees with the majority "
            "precedent OR explicitly flags a departure with a stated reason. Penalise a verdict that "
            "silently diverges from the precedent without acknowledging it."
        ),
        evaluation_params=[
            LLMTestCaseParams.INPUT,
            LLMTestCaseParams.ACTUAL_OUTPUT,
            LLMTestCaseParams.RETRIEVAL_CONTEXT,
        ],
        threshold=_THRESHOLD,
    )


def _calibration_metric() -> GEval:
    return GEval(
        name="should-have-abstained",
        criteria=(
            "A well-calibrated moderator knows what it does not know. Given the post (input) and the "
            "retrieved policy (retrieval context), the verdict is well-calibrated if it escalates to a "
            "human (disposition=escalate_to_human) when the post is genuinely ambiguous or no policy "
            "clearly applies, and acts confidently only when a policy clearly applies. Penalise a "
            "confident approve/remove on an ambiguous post where the agent should have abstained."
        ),
        evaluation_params=[
            LLMTestCaseParams.INPUT,
            LLMTestCaseParams.ACTUAL_OUTPUT,
            LLMTestCaseParams.RETRIEVAL_CONTEXT,
        ],
        threshold=_THRESHOLD,
    )


@pytest.mark.parametrize("case", _CASES, ids=[c["id"] for c in _CASES])
async def test_precedent_consistency(case: dict) -> None:
    workflow, corpus = build_workflow(Settings())
    target = await run_case(workflow, corpus, case)
    metric = _precedent_consistency_metric()
    metric.measure(target.test_case)
    record_metric(
        "precedent_consistency", passed=metric.score is not None and metric.score >= _THRESHOLD
    )
    assert_test(target.test_case, [metric])


@pytest.mark.parametrize("case", _AMBIGUOUS, ids=[c["id"] for c in _AMBIGUOUS])
async def test_calibration_should_have_abstained(case: dict) -> None:
    """On the SME-ambiguous posts a calibrated agent abstains; a confident verdict fails (FR5)."""
    workflow, corpus = build_workflow(Settings())
    target = await run_case(workflow, corpus, case)
    metric = _calibration_metric()
    metric.measure(target.test_case)
    record_metric("calibration", passed=metric.score is not None and metric.score >= _THRESHOLD)
    assert_test(target.test_case, [metric])


async def test_ragas_via_deepeval_wrapper() -> None:
    """RAGAS-through-DeepEval (ADR-0020): demonstrates the RAGAS technique via DeepEval's wrapper so it
    needs NO separate framework dependency. RAGAS did not earn a parallel install — DeepEval re-
    implemented its RAG metrics natively and wraps the remainder; this single named eval IS the entire
    RAGAS surface, kept to prove the judgement rather than tool-bloat."""
    ragas = pytest.importorskip("deepeval.metrics.ragas")
    case = load_gold_cases(limit=1)[0]
    workflow, corpus = build_workflow(Settings())
    target = await run_case(workflow, corpus, case)
    tc = LLMTestCase(
        input=target.test_case.input,
        actual_output=target.test_case.actual_output,
        expected_output=("disposition=remove" if case["gold_verdict"] == "flag" else "approve"),
        retrieval_context=target.test_case.retrieval_context,
    )
    metric = ragas.RAGASMetric(threshold=_THRESHOLD)
    metric.measure(tc)
    record_metric("ragas_wrapper", passed=metric.score is not None and metric.score >= _THRESHOLD)
    assert_test(tc, [metric])
