"""The self-check stage (FR3/FR4/FR5, ADR-0020). Pure + keyless — this is the deterministic proof of
grounding, precedent-consistency, and the abstain/calibration path (exit criteria 3). The DeepEval
faithfulness + calibration metrics prove the same with a live model."""

from __future__ import annotations

import pytest

from moderator_agent.config import Settings
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
    assert ground_cited_rules(["no-harassment", "no-spam"], _RETRIEVED) == [
        "no-harassment",
        "no-spam",
    ]


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
        _draft(cited_rules=["invented-rule"], confidence=0.9),
        _RETRIEVED,
        [],
        abstain_confidence=0.5,
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


# --- Safety invariant (FR-safety): never confidently approve flagged content ---

_REMOVE_PRECEDENT = [
    "remove (no-harassment): a near-identical harassing post was removed",
    "remove (no-harassment): repeat offender, same target",
]


def test_safety_invariant_escalates_a_confident_approve_against_remove_precedent() -> None:
    # A confident approve that diverges from majority-remove precedent must NOT auto-approve — it
    # escalates. This is the moderator-no-confident-approve-of-flag claim's guarantee; with the env
    # toggle MODERATOR_DISABLE_APPROVE_GUARD set, Settings() flips disable_approve_guard and this
    # assertion goes RED (the falsifier `pnpm prove moderator-no-confident-approve-of-flag --break`).
    settings = Settings()
    out = self_check(
        _draft(disposition="approve", cited_rules=[], confidence=0.9),
        _RETRIEVED,
        _REMOVE_PRECEDENT,
        abstain_confidence=settings.moderator_abstain_confidence,
        disable_approve_guard=settings.moderator_disable_approve_guard,
    )
    assert out.disposition == "escalate_to_human"


def test_disable_approve_guard_lets_a_confident_approve_of_flagged_content_through() -> None:
    # The deliberate bug: with the guard off, the confident approve ships as approve (the RED state).
    out = self_check(
        _draft(disposition="approve", cited_rules=[], confidence=0.9),
        _RETRIEVED,
        _REMOVE_PRECEDENT,
        abstain_confidence=0.5,
        disable_approve_guard=True,
    )
    assert out.disposition == "approve"


@pytest.mark.parametrize("cited", [[], ["no-harassment"]])
def test_safety_guard_escalates_whether_or_not_the_approve_carries_a_citation(
    cited: list[str],
) -> None:
    # The guard keys on (approve AND departs-from-precedent), NOT on whether the approve happens to
    # carry a grounded citation. A confident approve that diverges from majority-remove precedent must
    # escalate in BOTH the no-citation and the grounded-citation case — narrowing the guard to
    # `... and not cited` would let a CITED confident approve of flagged content ship as approve, so
    # the cited-non-empty case goes RED under that plant. ("no-harassment" is in _RETRIEVED, so it
    # survives grounding and the guard still has to fire on a non-empty cited list.)
    settings = Settings()
    out = self_check(
        _draft(disposition="approve", cited_rules=cited, confidence=0.9),
        _RETRIEVED,
        _REMOVE_PRECEDENT,
        abstain_confidence=settings.moderator_abstain_confidence,
        disable_approve_guard=settings.moderator_disable_approve_guard,
    )
    assert out.disposition == "escalate_to_human"


# --- Abstain threshold boundary (FR5): the comparator is `confidence < abstain_confidence` ---


def test_confidence_exactly_at_threshold_acts_not_escalates() -> None:
    # The abstain comparator is STRICT (`<`): a draft AT the threshold is confident enough to act, not
    # escalate. Pinned from Settings, never a literal. Flipping `<` -> `<=` escalates this equal-point
    # case (a grounded remove would become escalate_to_human) -> RED.
    threshold = Settings().moderator_abstain_confidence
    out = self_check(
        _draft(disposition="remove", cited_rules=["no-harassment"], confidence=threshold),
        _RETRIEVED,
        [],
        abstain_confidence=threshold,
    )
    assert out.disposition == "remove"


def test_confidence_just_below_threshold_escalates() -> None:
    # The other side of the boundary: strictly below the threshold escalates (FR5).
    threshold = Settings().moderator_abstain_confidence
    out = self_check(
        _draft(disposition="remove", cited_rules=["no-harassment"], confidence=threshold - 0.01),
        _RETRIEVED,
        [],
        abstain_confidence=threshold,
    )
    assert out.disposition == "escalate_to_human"
