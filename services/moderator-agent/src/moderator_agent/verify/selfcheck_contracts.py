"""CrossHair contracts over the REAL ``self_check`` decision function (ADR-0024, Phase 2).

The moderator's two safety guarantees are expressed here as PEP-316 docstring contracts
(``pre:`` / ``post:``) so CrossHair can *symbolically* search the input space for a counterexample,
rather than sampling examples the way the pytest suite does:

1. **Abstain (FR5).** A low-confidence draft escalates to a human instead of guessing.
2. **Approve guard (FR-safety).** The system never *confidently* ships an ``approve`` that departs
   from the retrieved precedent — such an approve escalates.

Both call the SAME ``self_check`` the LangGraph node uses (imported, not re-implemented), so the
contract and the code cannot drift. The deliberate-bug toggles are read from ``Settings()`` exactly
as production does, so:

    uv run crosshair check ...selfcheck_contracts        # guarded → NO counterexample (within budget)
    MODERATOR_DISABLE_ABSTAIN=1 uv run crosshair check …  # → CrossHair prints a concrete counterexample
    MODERATOR_DISABLE_APPROVE_GUARD=1 uv run crosshair …  # → CrossHair prints a concrete counterexample

This is a BOUNDED check: "no counterexample found within ``--per_condition_timeout``", not a total
proof. The pydantic model is built with ``model_construct`` (no validation) so CrossHair explores the
plain symbolic fields instead of stalling inside pydantic-core, which it cannot see through.
"""

from __future__ import annotations

from collections.abc import Sequence

from ..config import Settings
from ..schemas import LlmVerdict
from ..workflow.selfcheck import self_check

# A fixed retrieved-policy set; the symbolic surface is the draft (confidence/disposition/departs)
# and the precedents, which is where both guarantees actually branch.
_RETRIEVED = ("no-harassment", "no-spam", "escalate-ambiguous-intent")


def _draft(
    *, disposition: str, confidence: float, departs: bool, precedents: Sequence[str]
) -> LlmVerdict:
    # model_construct bypasses pydantic-core validation: CrossHair explores the raw fields directly.
    return LlmVerdict.model_construct(
        disposition=disposition,
        cited_rules=["no-harassment"],
        precedents=list(precedents),
        departs_from_precedent=departs,
        rationale="r",
        confidence=confidence,
    )


def abstain_escalates_low_confidence(
    confidence: float,
    disposition: str,
    departs: bool,
    precedents: list[str],
    abstain_confidence: float,
) -> str:
    """A draft below the abstain threshold must escalate to a human (FR5).

    pre: 0.0 <= confidence <= 1.0
    pre: 0.0 < abstain_confidence <= 1.0
    pre: disposition in ('approve', 'remove', 'escalate_to_human')
    pre: len(precedents) <= 2
    post: confidence >= abstain_confidence or __return__ == 'escalate_to_human'
    """
    s = Settings()
    out = self_check(
        _draft(
            disposition=disposition, confidence=confidence, departs=departs, precedents=precedents
        ),
        _RETRIEVED,
        precedents,
        abstain_confidence=abstain_confidence,
        disable_abstain=s.moderator_disable_abstain,
        disable_approve_guard=s.moderator_disable_approve_guard,
    )
    return out.disposition


def never_confidently_approves_flagged(
    confidence: float,
    disposition: str,
    departs: bool,
    precedents: list[str],
    abstain_confidence: float,
) -> tuple[str, bool]:
    """A final ``approve`` can never depart from precedent — a departing approve escalates (FR-safety).

    pre: 0.0 <= confidence <= 1.0
    pre: 0.0 < abstain_confidence <= 1.0
    pre: disposition in ('approve', 'remove', 'escalate_to_human')
    pre: len(precedents) <= 2
    post: __return__[0] != 'approve' or not __return__[1]
    """
    s = Settings()
    out = self_check(
        _draft(
            disposition=disposition, confidence=confidence, departs=departs, precedents=precedents
        ),
        _RETRIEVED,
        precedents,
        abstain_confidence=abstain_confidence,
        disable_abstain=s.moderator_disable_abstain,
        disable_approve_guard=s.moderator_disable_approve_guard,
    )
    return (out.disposition, out.departs_from_precedent)
