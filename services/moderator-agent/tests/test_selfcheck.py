"""The self-check stage (FR3/FR4/FR5, ADR-0020). Pure + keyless — this is the deterministic proof of
grounding, precedent-consistency, and the abstain/calibration path (exit criteria 3). The DeepEval
faithfulness + calibration metrics prove the same with a live model."""

from __future__ import annotations

from moderator_agent.schemas import LlmVerdict
from moderator_agent.workflow.selfcheck import (
    ground_cited_rules,
    infer_departs_from_precedent,
    self_check,
)

_RETRIEVED = ["no-harassment", "no-spam", "escalate-ambiguous-intent"]


def _draft(**overrides: object) -> LlmVerdict:
    base = {
        "disposition": "remove",
        "cited_rules": ["no-harassment"],
        "precedents": [],
        "departs_from_precedent": False,
        "rationale": "violates harassment",
        "confidence": 0.9,
    }
    base.update(overrides)
    return LlmVerdict.model_validate(base)


def test_grounding_drops_a_hallucinated_citation() -> None:
    assert ground_cited_rules(["no-harassment", "rule-that-was-not-retrieved"], _RETRIEVED) == [
        "no-harassment"
    ]


def test_grounding_keeps_retrieved_citations() -> None:
    assert ground_cited_rules(["no-harassment", "no-spam"], _RETRIEVED) == ["no-harassment", "no-spam"]


def test_self_check_drops_hallucinated_policy_from_the_verdict() -> None:
    # FR3: a draft that cites a rule never retrieved must not carry it to the wire.
    out = self_check(
        _draft(cited_rules=["no-harassment", "invented-rule"]),
        _RETRIEVED,
        [],
        abstain_confidence=0.5,
    )
    assert out.cited_rules == ["no-harassment"]
    assert out.disposition == "remove"


def test_ungrounded_toggle_lets_a_hallucinated_citation_survive() -> None:
    # The deliberate bug (MODERATOR_UNGROUNDED): grounding is skipped, so a hallucinated policy
    # survives — exactly what the DeepEval faithfulness metric is there to catch.
    out = self_check(
        _draft(cited_rules=["invented-rule"]),
        _RETRIEVED,
        [],
        abstain_confidence=0.5,
        ungrounded=True,
    )
    assert out.cited_rules == ["invented-rule"]


def test_low_confidence_escalates_to_human() -> None:
    out = self_check(_draft(confidence=0.2), _RETRIEVED, [], abstain_confidence=0.5)
    assert out.disposition == "escalate_to_human"


def test_a_removal_with_no_grounded_citation_escalates() -> None:
    # A remove whose only citation was hallucinated (and dropped) rests on nothing — escalate (FR5).
    out = self_check(
        _draft(cited_rules=["invented-rule"], confidence=0.9), _RETRIEVED, [], abstain_confidence=0.5
    )
    assert out.disposition == "escalate_to_human"


def test_disable_abstain_keeps_a_low_confidence_disposition() -> None:
    # The deliberate bug (MODERATOR_DISABLE_ABSTAIN): the agent guesses instead of escalating.
    out = self_check(
        _draft(confidence=0.2), _RETRIEVED, [], abstain_confidence=0.5, disable_abstain=True
    )
    assert out.disposition == "remove"


def test_departs_from_precedent_set_when_diverging() -> None:
    # FR4: precedent removed similar content; this draft approves → the divergence is flagged.
    precedents = ["remove (no-spam): a near-identical promo was removed"]
    assert infer_departs_from_precedent("approve", precedents) is True
    out = self_check(
        _draft(disposition="approve", cited_rules=[], confidence=0.9),
        _RETRIEVED,
        precedents,
        abstain_confidence=0.5,
    )
    assert out.departs_from_precedent is True


def test_no_departure_when_consistent_with_precedent() -> None:
    precedents = ["approve (no rule): a similar benign post was approved"]
    assert infer_departs_from_precedent("approve", precedents) is False
