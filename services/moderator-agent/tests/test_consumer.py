import pytest

from helpers import make_event, make_workflow
from moderator_agent.consumer import handle_post_event
from moderator_agent.subjects import post_created

# A distinct, validly-branded community id for the cross-tenant case (26-char Crockford body).
_OTHER_COMMUNITY = "comm_" + "0" * 25 + "1"


async def test_handle_post_event_reviews_and_records_a_matching_message() -> None:
    workflow, decisions, _ = make_workflow()
    event = make_event(body="you are an idiot and nobody wants you here")
    await handle_post_event(
        workflow,
        data=event.model_dump_json().encode(),
        headers={},
        subject=post_created(event.community_id),
    )
    assert await decisions.count() == 1


async def test_handle_post_event_rejects_a_cross_tenant_subject() -> None:
    # The subject's community must match the payload's — a wildcard subscriber's tenant-leak insurance.
    workflow, decisions, _ = make_workflow()
    event = make_event()  # payload community is COMMUNITY
    with pytest.raises(ValueError, match="tenant leak"):
        await handle_post_event(
            workflow,
            data=event.model_dump_json().encode(),
            headers={},
            subject=post_created(_OTHER_COMMUNITY),
        )
    assert await decisions.count() == 0  # nothing recorded for the mismatched message


async def test_handle_post_event_rejects_a_malformed_subject() -> None:
    workflow, decisions, _ = make_workflow()
    event = make_event()
    with pytest.raises(ValueError, match="malformed subject"):
        await handle_post_event(
            workflow,
            data=event.model_dump_json().encode(),
            headers={},
            subject="qaroom.content.posts.bad",  # 4 segments, not 5
        )
    assert await decisions.count() == 0
