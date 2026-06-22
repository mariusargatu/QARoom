"""Round-trip contract between the precedent WRITER and the precedent READER (FR4, ADR-0020).

`persistence/knowledge.py:_summary` serialises a recorded `ModerationDecision` into the precedent
string that gets stored in pgvector; `workflow/selfcheck.py:precedent_dispositions` parses that exact
string back into a leading disposition token, and `infer_departs_from_precedent` reasons over it. The
two live in different modules with no shared format constant — a change to the `_summary` f-string
(e.g. prefixing a `[v2]` token) would silently break parsing and the self-check would stop seeing any
precedent. This test pins the format end-to-end: build a real decision per disposition, run it through
the writer, and assert the reader recovers the disposition and the departure check fires.
"""

from __future__ import annotations

import pytest

from moderator_agent.persistence.knowledge import _summary
from moderator_agent.schemas import ModerationDecision
from moderator_agent.workflow.selfcheck import (
    infer_departs_from_precedent,
    precedent_dispositions,
)

_B = "0" * 26

# For each precedent disposition, a CONTRASTING disposition that must read as a departure.
_CONTRAST = {
    "approve": "remove",
    "remove": "approve",
    "escalate_to_human": "remove",
}


def _decision(disposition: str) -> ModerationDecision:
    base = {
        "decision_id": f"mdec_{_B}",
        "event_id": f"evt_{_B}",
        "post_id": f"post_{_B}",
        "community_id": f"comm_{_B}",
        "author_id": f"user_{_B}",
        "disposition": disposition,
        "cited_rules": ["no-harassment"],
        "precedents": [],
        "departs_from_precedent": False,
        "rationale": "targets an individual",
        "confidence": 0.9,
        "model": "test-model",
        "created_at": "2026-06-04T00:00:00.000Z",
    }
    return ModerationDecision.model_validate(base)


@pytest.mark.parametrize("disposition", ["approve", "remove", "escalate_to_human"])
def test_summary_round_trips_back_to_its_disposition(disposition: str) -> None:
    # The writer's output must parse back to exactly the disposition it encoded — the leading token
    # contract `precedent_dispositions` relies on. Prefixing a bracketed token to the `_summary`
    # f-string shifts the leading token off the disposition word -> parser yields [] -> RED.
    summary = _summary(_decision(disposition))
    assert precedent_dispositions([summary]) == [disposition]


@pytest.mark.parametrize("disposition", ["approve", "remove", "escalate_to_human"])
def test_departure_check_fires_on_a_real_summary(disposition: str) -> None:
    # A drafted disposition that contrasts with the stored precedent must read as a departure. This
    # only holds if `_summary` still emits the disposition as the leading token the parser recovers —
    # a prefixed `_summary` token makes the precedent unparseable, so departure can no longer fire.
    summary = _summary(_decision(disposition))
    assert infer_departs_from_precedent(_CONTRAST[disposition], [summary]) is True
