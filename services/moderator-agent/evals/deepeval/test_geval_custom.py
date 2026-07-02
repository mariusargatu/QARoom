"""Custom G-Eval metrics + the RAGAS-via-DeepEval demonstration (FR4/FR5, ADR-0020).

Two ``GEval`` metrics encode QARoom-specific judgements no off-the-shelf metric covers:

- **precedent-consistency (FR4)** — the verdict is consistent with the retrieved precedent for similar
  content, or it sets ``departs_from_precedent`` with a reason. A silent divergence fails.
- **calibration / should-have-abstained (FR5)** — on low retrieval confidence or conflicting rules the
  agent must ``escalate_to_human`` rather than guess. A confident verdict on an ambiguous post fails.

The RAGAS demonstration: per ADR-0020 (amended 2026-06) the RAGAS surface is DeepEval's NATIVE
re-implementation of the RAGAS metrics (faithfulness, contextual precision / recall / relevancy),
gated in ``test_rag_metrics.py`` — no parallel install. The literal ``RagasMetric`` wrapper test below
is kept as a breadcrumb but SKIPS: DeepEval 4.x moved it behind the external ``ragas`` package, which
pins a langchain-community path removed in langchain 1.x (the moderator's stack), so it cannot be
installed without breaking production langchain. The cost ceiling is the shared pre-flight guard
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


async def _calibration_trial_passes(workflow: object, corpus: object, case: dict) -> bool:
    """One calibration trial: run the agent on the case and G-Eval the disposition. Both the agent and
    the judge are gpt-5.x reasoning models that ignore seed/temperature, so a single trial of this
    borderline judgement is non-deterministic — hence best-of-N at the call site."""
    target = await run_case(workflow, corpus, case)
    metric = _calibration_metric()
    metric.measure(target.test_case)
    return metric.score is not None and metric.score >= _THRESHOLD


@pytest.mark.parametrize("case", _AMBIGUOUS, ids=[c["id"] for c in _AMBIGUOUS])
async def test_calibration_should_have_abstained(case: dict) -> None:
    """On the SME-ambiguous posts a calibrated agent abstains; a confident verdict fails (FR5).

    Best-of-3 (majority): the moderator and the G-Eval judge are gpt-5.x reasoning models that drop
    seed/temperature (see ``determinism.py``), so a single trial of this borderline case flips
    run-to-run around the 0.5 threshold. Majority-of-3 stabilises the gate WITHOUT weakening the
    threshold or the gold set — a genuinely mis-calibrated agent still loses ≥2 of 3 trials. Short-
    circuits at 2 passes or 2 fails, so the usual cost is 2 trials, 3 only on a split."""
    workflow, corpus = build_workflow(Settings())
    passes = 0
    fails = 0
    for _ in range(3):
        if await _calibration_trial_passes(workflow, corpus, case):
            passes += 1
        else:
            fails += 1
        if passes >= 2 or fails >= 2:
            break
    majority = passes >= 2
    record_metric("calibration", passed=majority)
    assert majority, (
        f"calibration best-of-3 failed for {case['id']}: only {passes} of {passes + fails} trials "
        f"passed (threshold {_THRESHOLD}) — a confident verdict on an ambiguous post that should "
        "have escalated to a human."
    )


async def test_ragas_via_deepeval_wrapper() -> None:
    """RAGAS-through-DeepEval (ADR-0020, amended 2026-06). DeepEval re-implemented the RAGAS metrics
    NATIVELY (faithfulness, contextual precision / recall / relevancy — all gated in test_rag_metrics.py);
    that IS our RAGAS surface and needs no parallel install. This test exercises the literal RagasMetric
    WRAPPER on top, but DeepEval 4.x moved that wrapper behind the external ``ragas`` package, and
    ``ragas`` pins ``langchain_community.chat_models.vertexai`` — a path removed in langchain 1.x, the
    moderator's stack — so it cannot be installed here without breaking production langchain. The wrapper
    therefore SKIPS unless ``ragas`` is importable; the native metrics carry the technique regardless."""
    pytest.importorskip(
        "ragas",
        reason="ragas pins a langchain-community path removed in langchain 1.x; the native DeepEval RAG "
        "metrics (test_rag_metrics.py) are the RAGAS surface instead (ADR-0020)",
    )
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
    metric = ragas.RagasMetric(threshold=_THRESHOLD)
    metric.measure(tc)
    record_metric("ragas_wrapper", passed=metric.score is not None and metric.score >= _THRESHOLD)
    assert_test(tc, [metric])
