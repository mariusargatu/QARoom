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
        "verdict": "flag",
        "rule_id": "no-harassment",
        "reason": "targets an individual with a slur",
        "confidence": 0.91,
        "model": "openai:gpt-5.5-2026-04-23",
        "occurred_at": "2026-06-04T00:00:00.000Z",
    }
    base.update(overrides)
    return ModerationDecisionRecordedEvent.model_validate(base)


def test_pydantic_event_validates_against_the_zod_json_schema() -> None:
    jsonschema.validate(_event().model_dump(mode="json"), _SCHEMA)


def test_allow_with_null_rule_id_validates() -> None:
    event = _event(verdict="allow", rule_id=None)
    jsonschema.validate(event.model_dump(mode="json"), _SCHEMA)


def test_pydantic_and_zod_describe_the_same_field_set() -> None:
    assert set(ModerationDecisionRecordedEvent.model_fields) == set(_SCHEMA["properties"])


@pytest.mark.parametrize(
    "overrides",
    [
        {"model": ""},  # min_length 1
        {"reason": "x" * 2001},  # max_length 2000
        {"reason": "bad\x00text"},  # NUL guard
        {"verdict": "reject"},  # not in the enum
        {"confidence": 1.5},  # out of [0, 1]
        {"rule_id": "x" * 101},  # max_length 100
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
