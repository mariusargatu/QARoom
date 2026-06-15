"""Judge-reliability meta-eval — testing the TEST (JRH-style, mid-2026 best practice).

The DeepEval LLM-as-judge metrics (citation-grounding, calibration, precedent-consistency) judge the
agent. But who judges the judge? An unreliable or DRIFTING judge silently invalidates every eval that
uses it — a green that means nothing. This module stress-tests the citation-grounding judge directly:
feed it fixtures whose correct verdict is OBJECTIVELY known (a cited rule is either present in the
retrieval context or it is not) and assert the judge scores them right.

Why citation-grounding and not calibration: its ground truth is objective (literal presence of a rule
id), so a judge that gets it wrong is unambiguously unreliable — the ideal probe. Calibration /
precedent-consistency are inherently fuzzy and have no crisp gold to meta-test against.

The judge model is PINNED (``_support.JUDGE_MODEL``); a judge swap or an upstream model change that
breaks these fixtures is caught here as a JUDGE regression, not misread as an agent regression. Same
gating as the rest of the eval lane: ``importorskip`` + ``skipif`` on the key (the judge is an LLM).
"""

from __future__ import annotations

import os

import pytest

deepeval = pytest.importorskip("deepeval")

from moderator_agent.config import Settings  # noqa: E402

from ._support import JUDGE_MODEL, citation_grounding_metric, record_metric  # noqa: E402

pytestmark = [
    pytest.mark.deepeval,
    pytest.mark.skipif(
        not os.environ.get("OPENAI_API_KEY"),
        reason="needs OPENAI_API_KEY (the judge under test is an LLM, ADR-0020)",
    ),
]

_THRESHOLD = 0.5
_RETRIEVAL_CONTEXT = [
    "no-harassment [rule]: No personal attacks or slurs.",
    "no-spam [rule]: No spam or undisclosed advertising.",
]

# Each fixture: a verdict whose citation grounding is OBJECTIVELY known. ``should_pass`` is the ground
# truth the judge must reproduce — a GROUNDED citation passes, a FABRICATED one fails.
_FIXTURES = [
    {
        "id": "grounded-cite-passes",
        "should_pass": True,
        "actual_output": (
            "disposition=remove; cited_rules=['no-harassment']; "
            "rationale=removed under the no-harassment rule"
        ),
    },
    {
        "id": "second-grounded-cite-passes",
        "should_pass": True,
        "actual_output": (
            "disposition=remove; cited_rules=['no-spam']; rationale=undisclosed advertising"
        ),
    },
    {
        "id": "fabricated-cite-fails",
        "should_pass": False,
        "actual_output": (
            "disposition=remove; cited_rules=['rule-no-blasphemy']; "
            "rationale=removed under the no-blasphemy rule"
        ),
    },
    {
        "id": "second-fabricated-cite-fails",
        "should_pass": False,
        "actual_output": (
            "disposition=remove; cited_rules=['no-violence']; rationale=removed under no-violence"
        ),
    },
]


def test_the_judge_model_is_pinned() -> None:
    """A pinned judge is the whole point — drift is only catchable against a fixed judge (JRH)."""
    assert JUDGE_MODEL, "the citation-grounding judge must name a pinned model"


@pytest.mark.parametrize("fixture", _FIXTURES, ids=[f["id"] for f in _FIXTURES])
def test_citation_grounding_judge_reproduces_objective_ground_truth(fixture: dict) -> None:
    """The judge must PASS a grounded citation and FAIL a fabricated one. A judge that disagrees with
    this objective ground truth is unreliable — the failure points at the JUDGE, not the agent."""
    from deepeval.test_case import LLMTestCase

    tc = LLMTestCase(
        input="(meta-eval: judging a fixed verdict, not running the agent)",
        actual_output=fixture["actual_output"],
        retrieval_context=list(_RETRIEVAL_CONTEXT),
    )
    metric = citation_grounding_metric(_THRESHOLD)
    metric.measure(tc)
    judged_pass = metric.score is not None and metric.score >= _THRESHOLD
    record_metric("judge_reliability", passed=(judged_pass == fixture["should_pass"]))
    assert judged_pass == fixture["should_pass"], (
        f"judge unreliable on {fixture['id']}: expected pass={fixture['should_pass']}, "
        f"got score={metric.score} (reason: {getattr(metric, 'reason', None)})"
    )


def test_settings_loads() -> None:
    # Cheap guard that the module wiring imports without the agent — keeps the meta-eval self-contained.
    assert Settings().moderator_model
