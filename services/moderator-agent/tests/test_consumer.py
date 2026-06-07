import pytest
from nats.js.errors import NotFoundError

import moderator_agent.consumer as consumer_mod
from helpers import make_event, make_workflow
from moderator_agent.config import Settings
from moderator_agent.consumer import PostEventConsumer, handle_post_event
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


class _FlakyJs:
    """A JetStream double whose pull_subscribe raises NotFoundError the first `fail_times` calls,
    modelling the boot race where the shared stream is not yet created."""

    def __init__(self, fail_times: int) -> None:
        self.fail_times = fail_times
        self.calls = 0

    async def pull_subscribe(self, subject: str, durable: str, stream: str) -> str:
        self.calls += 1
        if self.calls <= self.fail_times:
            raise NotFoundError()
        return "subscription"


async def test_subscribe_retries_until_the_stream_appears(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(consumer_mod, "_STREAM_WAIT_INTERVAL_S", 0.0)
    workflow, _, _ = make_workflow()
    js = _FlakyJs(fail_times=2)
    consumer = PostEventConsumer(Settings(), workflow, js)
    sub = await consumer._subscribe_with_retry()
    assert sub == "subscription"
    assert js.calls == 3  # two NotFoundError, then success


async def test_subscribe_gives_up_after_max_attempts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(consumer_mod, "_STREAM_WAIT_INTERVAL_S", 0.0)
    monkeypatch.setattr(consumer_mod, "_STREAM_WAIT_ATTEMPTS", 3)
    workflow, _, _ = make_workflow()
    js = _FlakyJs(fail_times=99)
    consumer = PostEventConsumer(Settings(), workflow, js)
    with pytest.raises(NotFoundError):
        await consumer._subscribe_with_retry()
    assert js.calls == 3
