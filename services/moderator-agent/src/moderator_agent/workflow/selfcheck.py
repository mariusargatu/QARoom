"""The self-check stage — pure, deterministic validation of a drafted verdict (FR3/FR4/FR5, ADR-0020).

This is the ``Drafted --DraftProduced--> SelfChecked`` node's logic, factored out so it is unit-testable
WITHOUT an LLM or a key (the abstain/grounding exit criteria are proven here, keyless). It makes three
guarantees, each defeatable by a deliberate-bug toggle so a test can prove it has teeth:

1. **Grounding (FR3).** Drop any ``cited_rules`` the draft invented that were NOT in the retrieved
   policy — a hallucinated-policy citation never survives to the wire (unless ``ungrounded``).
2. **Precedent consistency (FR4).** If the disposition diverges from the majority retrieved precedent,
   set ``departs_from_precedent`` so the divergence is explicit, not silent.
3. **Calibration / abstain (FR5).** Escalate to a human on low confidence, or on a ``remove`` that —
   after grounding — rests on no retrieved policy (an ungrounded removal). Defeated by ``disable_abstain``.

Returns a NEW ``LlmVerdict`` (no mutation — the draft is preserved in the run state for observability).
"""

from __future__ import annotations

from collections.abc import Sequence

from ..schemas import LlmVerdict

_DISPOSITIONS = ("approve", "remove", "escalate_to_human")


def ground_cited_rules(cited: Sequence[str], retrieved_ids: Sequence[str]) -> list[str]:
    """Keep only citations that name a policy entry actually retrieved for this post (FR3)."""
    allowed = set(retrieved_ids)
    return [c for c in cited if c in allowed]


def precedent_dispositions(precedents: Sequence[str]) -> list[str]:
    """The leading disposition token of each precedent summary (``"remove (no-spam): …"``)."""
    out: list[str] = []
    for p in precedents:
        head = p.split(" ", 1)[0].strip().lower()
        if head in _DISPOSITIONS:
            out.append(head)
    return out


def infer_departs_from_precedent(disposition: str, precedents: Sequence[str]) -> bool:
    """True when a non-escalation disposition diverges from the majority retrieved precedent (FR4)."""
    if disposition == "escalate_to_human":
        return False
    disps = precedent_dispositions(precedents)
    if not disps:
        return False
    majority = max(set(disps), key=disps.count)
    return majority != disposition


def self_check(
    verdict: LlmVerdict,
    retrieved_ids: Sequence[str],
    precedents: Sequence[str],
    *,
    abstain_confidence: float,
    ungrounded: bool = False,
    disable_abstain: bool = False,
) -> LlmVerdict:
    cited = list(verdict.cited_rules) if ungrounded else ground_cited_rules(
        verdict.cited_rules, retrieved_ids
    )
    disposition = verdict.disposition
    departs = verdict.departs_from_precedent or infer_departs_from_precedent(disposition, precedents)

    if not disable_abstain:
        if verdict.confidence < abstain_confidence:
            disposition = "escalate_to_human"
        elif disposition == "remove" and not cited:
            # A removal that, after grounding, cites no retrieved policy — do not guess, escalate.
            disposition = "escalate_to_human"

    rationale = verdict.rationale
    if disposition == "escalate_to_human" and verdict.disposition != "escalate_to_human":
        rationale = f"escalated (low confidence or ungrounded removal): {rationale}"[:4000]

    return verdict.model_copy(
        update={
            "disposition": disposition,
            "cited_rules": cited,
            "departs_from_precedent": departs,
            "rationale": rationale,
        }
    )
