import json
from pathlib import Path

import jsonschema
import pytest
from pydantic import ValidationError

from moderator_agent.schemas import ModerationDecisionRecordedEvent

_SCHEMA = json.loads(
    (
        Path(__file__).resolve().parents[1]
        / "contracts"
        / "moderation-decision-recorded.schema.json"
    ).read_text()
)
_B = "0" * 26


def _event(**overrides: object) -> ModerationDecisionRecordedEvent:
    base = {
        "event_id": f"evt_{_B}",
        "decision_id": f"mdec_{_B}",
        "post_id": f"post_{_B}",
        "community_id": f"comm_{_B}",
        "author_id": f"user_{_B}",
        "disposition": "remove",
        "cited_rules": ["no-harassment"],
        "precedents": ["remove (no-harassment): a prior slur removal"],
        "departs_from_precedent": False,
        "rationale": "targets an individual with a slur, matching the cited no-harassment rule",
        "confidence": 0.91,
        "model": "openai:gpt-5.5-2026-04-23",
        "occurred_at": "2026-06-04T00:00:00.000Z",
    }
    base.update(overrides)
    return ModerationDecisionRecordedEvent.model_validate(base)


def test_pydantic_event_validates_against_the_zod_json_schema() -> None:
    jsonschema.validate(_event().model_dump(mode="json"), _SCHEMA)


def test_approve_with_empty_citations_validates() -> None:
    event = _event(disposition="approve", cited_rules=[], precedents=[], rationale="no rule matched")
    jsonschema.validate(event.model_dump(mode="json"), _SCHEMA)


def test_escalate_disposition_validates() -> None:
    event = _event(disposition="escalate_to_human", cited_rules=[], rationale="ambiguous — escalated")
    jsonschema.validate(event.model_dump(mode="json"), _SCHEMA)


def test_pydantic_and_zod_describe_the_same_field_set() -> None:
    assert set(ModerationDecisionRecordedEvent.model_fields) == set(_SCHEMA["properties"])


@pytest.mark.parametrize(
    "overrides",
    [
        {"model": ""},  # min_length 1
        {"rationale": "x" * 4001},  # max_length 4000
        {"rationale": "bad\x00text"},  # NUL guard
        {"disposition": "banish"},  # not in the enum
        {"confidence": 1.5},  # out of [0, 1]
        {"cited_rules": ["x" * 101]},  # element max_length 100
        {"cited_rules": [f"r{n}" for n in range(17)]},  # array max 16
        {"precedents": ["x" * 2001]},  # element max_length 2000
        {"precedents": ["bad\x00text"]},  # element NUL guard
        {"occurred_at": "2026-06-04T00:00:00"},  # missing the Z suffix
        {"occurred_at": "not-a-datetime"},
    ],
)
def test_pydantic_rejects_constraint_violations(overrides: dict) -> None:
    # Guards against a constraint silently dropping on the Pydantic side — the field-set check above
    # would still pass, so the wire format could drift from the Zod source without this.
    with pytest.raises(ValidationError):
        _event(**overrides)


def test_confidence_boundaries_are_accepted_on_both_sides() -> None:
    jsonschema.validate(_event(confidence=0.0).model_dump(mode="json"), _SCHEMA)
    jsonschema.validate(_event(confidence=1.0).model_dump(mode="json"), _SCHEMA)
