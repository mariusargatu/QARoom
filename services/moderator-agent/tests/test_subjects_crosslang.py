import json
from pathlib import Path

import pytest

from moderator_agent import subjects

_GOLDEN = Path(__file__).resolve().parents[1] / "contracts" / "subjects.golden.json"
_SAMPLE = "comm_" + "0" * 26


def test_python_builders_match_the_typescript_golden() -> None:
    golden = json.loads(_GOLDEN.read_text())
    assert subjects.post_created(_SAMPLE) == golden["post_created"]
    assert subjects.posts_created_any_community() == golden["posts_created_any_community"]
    assert subjects.moderation_decision_recorded(_SAMPLE) == golden["moderation_decision_recorded"]
    assert (
        subjects.MODERATION_DECISION_RECORDED_ADDRESS
        == golden["moderation_decision_recorded_address"]
    )
    # The event-version header must match the TS source of truth (R1 — otherwise a 1→2 bump on one
    # side only would pass every other gate silently). The golden carries it from the Zod constant.
    assert (
        subjects.MODERATION_DECISION_RECORDED_VERSION
        == golden["moderation_decision_recorded_version"]
    )


def test_parse_subject_recovers_the_tenant_at_position_three() -> None:
    parsed = subjects.parse_subject(subjects.moderation_decision_recorded(_SAMPLE))
    assert parsed.service == "moderator"
    assert parsed.entity == "decision"
    assert parsed.community_id == _SAMPLE
    assert parsed.event == "recorded"


def test_parse_subject_rejects_the_wrong_arity() -> None:
    with pytest.raises(ValueError):
        subjects.parse_subject("qaroom.content.posts.created")


def test_parse_subject_rejects_a_non_community_position_three() -> None:
    with pytest.raises(ValueError):
        subjects.parse_subject("qaroom.content.posts.not-a-comm.created")
